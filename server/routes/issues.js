/* ============================================================
   Routes: issues — blockers / issues raised against a job.
   Mounted under requireAuth at /api/issues.
   Read: anyone who can see the job. Raise: assignees, team leads, backend.
   Resolve / edit: the raiser, a lead of one of the job's teams, or backend.
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, isBackend } = require('../db');
const { notify, logActivity, teamNamesLedBy, jobTeamNames, jobTeamIds } = require('../helpers');

const getJob = id => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
const getIssue = id => db.prepare('SELECT * FROM issues WHERE id = ?').get(id);
const isAssigned = (jobId, userId) =>
  !!db.prepare('SELECT 1 FROM job_assignments WHERE job_id=? AND user_id=?').get(jobId, userId);
const leadOnJob = (userId, jobId) => {
  const led = teamNamesLedBy(userId);
  return jobTeamNames(jobId).some(t => led.includes(t));
};
function canSeeJob(user, job) {
  if (isBackend(user.role)) return true;
  if (user.role === 'team_lead' && leadOnJob(user.id, job.id)) return true;
  return isAssigned(job.id, user.id);
}
const serializeIssue = i => {
  const nm = id => { const u = id && db.prepare('SELECT name FROM users WHERE id=?').get(id); return u ? u.name : null; };
  return { ...i, raised_by_name: nm(i.raised_by), assigned_to_name: nm(i.assigned_to), resolved_by_name: nm(i.resolved_by) };
};

/* list issues for a job (or all open, for backend dashboards) */
router.get('/', (req, res) => {
  if (req.query.job_id) {
    const job = getJob(+req.query.job_id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    if (!canSeeJob(req.user, job)) return res.status(403).json({ error: 'No access to this job.' });
    return res.json(db.prepare('SELECT * FROM issues WHERE job_id=? ORDER BY (status=\'open\') DESC, id DESC')
      .all(job.id).map(serializeIssue));
  }
  if (!isBackend(req.user.role)) return res.status(400).json({ error: 'job_id is required.' });
  const status = req.query.status === 'resolved' ? 'resolved' : req.query.status === 'all' ? null : 'open';
  const rows = status
    ? db.prepare(`SELECT i.*, j.job_no FROM issues i JOIN jobs j ON j.id=i.job_id WHERE i.status=? ORDER BY i.id DESC`).all(status)
    : db.prepare(`SELECT i.*, j.job_no FROM issues i JOIN jobs j ON j.id=i.job_id ORDER BY i.id DESC`).all();
  res.json(rows.map(serializeIssue));
});

/* raise an issue */
router.post('/', (req, res) => {
  const { job_id, title, detail, severity, assigned_to } = req.body || {};
  const job = getJob(+job_id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!canSeeJob(req.user, job)) return res.status(403).json({ error: 'No access to this job.' });
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'A title is required.' });
  const sev = ['blocker', 'issue', 'note'].includes(severity) ? severity : 'blocker';
  const info = db.prepare(`INSERT INTO issues (job_id,title,detail,severity,status,raised_by,assigned_to)
    VALUES (?,?,?,?, 'open', ?, ?)`).run(job.id, String(title).trim(), String(detail || ''), sev,
    req.user.id, assigned_to ? +assigned_to : null);
  const issue = getIssue(info.lastInsertRowid);
  logActivity({ actor: req.user, entity_type: 'issue', entity_id: issue.id, job_id: job.id,
    action: 'raised', field: 'severity', new_value: sev, note: issue.title });
  // notify leads of the job's teams + assignees + the assigned owner, except the raiser
  const leadIds = db.prepare(`SELECT DISTINCT t.lead_id FROM teams t WHERE t.id IN
    (${jobTeamIds(job.id).map(() => '?').join(',') || '0'})`).all(...jobTeamIds(job.id)).map(r => r.lead_id);
  const targets = new Set([...leadIds,
    ...db.prepare('SELECT user_id FROM job_assignments WHERE job_id=?').all(job.id).map(r => r.user_id),
    issue.assigned_to].filter(Boolean));
  targets.delete(req.user.id);
  notify([...targets], `${sev === 'blocker' ? 'Blocker' : 'Issue'} raised on ${job.job_no}: ${issue.title}`, 'issue', job.id);
  res.status(201).json(serializeIssue(issue));
});

/* edit an issue */
router.put('/:id', (req, res) => {
  const issue = getIssue(+req.params.id);
  if (!issue) return res.status(404).json({ error: 'Issue not found.' });
  const job = getJob(issue.job_id);
  const mayEdit = isBackend(req.user.role) || issue.raised_by === req.user.id || leadOnJob(req.user.id, job.id);
  if (!mayEdit) return res.status(403).json({ error: 'You cannot edit this issue.' });
  const { title, detail, severity, assigned_to, status } = req.body || {};
  const sets = [], args = [];
  if (title != null) { sets.push('title=?'); args.push(String(title).trim()); }
  if (detail != null) { sets.push('detail=?'); args.push(String(detail)); }
  if (severity && ['blocker', 'issue', 'note'].includes(severity)) { sets.push('severity=?'); args.push(severity); }
  if (assigned_to !== undefined) { sets.push('assigned_to=?'); args.push(assigned_to ? +assigned_to : null); }
  if (status === 'open' || status === 'resolved') {
    sets.push('status=?'); args.push(status);
    if (status === 'resolved') { sets.push("resolved_by=?, resolved_at=datetime('now')"); args.push(req.user.id); }
    else { sets.push('resolved_by=NULL, resolved_at=NULL'); }
  }
  if (sets.length) { db.prepare(`UPDATE issues SET ${sets.join(', ')} WHERE id=?`).run(...args, issue.id); }
  logActivity({ actor: req.user, entity_type: 'issue', entity_id: issue.id, job_id: job.id,
    action: status === 'resolved' ? 'resolved' : 'updated', note: issue.title });
  res.json(serializeIssue(getIssue(issue.id)));
});

/* resolve shortcut */
router.post('/:id/resolve', (req, res) => {
  const issue = getIssue(+req.params.id);
  if (!issue) return res.status(404).json({ error: 'Issue not found.' });
  const job = getJob(issue.job_id);
  const mayEdit = isBackend(req.user.role) || issue.raised_by === req.user.id || leadOnJob(req.user.id, job.id);
  if (!mayEdit) return res.status(403).json({ error: 'You cannot resolve this issue.' });
  db.prepare("UPDATE issues SET status='resolved', resolved_by=?, resolved_at=datetime('now') WHERE id=?")
    .run(req.user.id, issue.id);
  logActivity({ actor: req.user, entity_type: 'issue', entity_id: issue.id, job_id: job.id,
    action: 'resolved', note: issue.title });
  if (issue.raised_by && issue.raised_by !== req.user.id)
    notify([issue.raised_by], `Resolved on ${job.job_no}: ${issue.title}`, 'issue', job.id);
  res.json(serializeIssue(getIssue(issue.id)));
});

/* delete an issue (raiser or backend) */
router.delete('/:id', (req, res) => {
  const issue = getIssue(+req.params.id);
  if (!issue) return res.status(404).json({ error: 'Issue not found.' });
  if (!isBackend(req.user.role) && issue.raised_by !== req.user.id)
    return res.status(403).json({ error: 'You cannot delete this issue.' });
  db.prepare('DELETE FROM issues WHERE id=?').run(issue.id);
  logActivity({ actor: req.user, entity_type: 'issue', entity_id: issue.id, job_id: issue.job_id,
    action: 'deleted', note: issue.title });
  res.json({ ok: true });
});

module.exports = router;
