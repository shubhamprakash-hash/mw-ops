/* ============================================================
   Routes: jobs
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, isAdmin, STAGES } = require('../db');
const { requireAdmin, requireRole, gateJobList } = require('../middleware');
const { serializeJob } = require('../helpers');

const getJob = id => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);

/* All jobs (board). Admins see all + money; team leads see their team;
   members see jobs they're assigned to. */
router.get('/', (req, res) => {
  const { role, id, team } = req.user;
  let rows;
  if (isAdmin(role)) {
    rows = db.prepare('SELECT * FROM jobs ORDER BY id DESC').all();
  } else if (role === 'team_lead') {
    rows = db.prepare('SELECT * FROM jobs WHERE team = ? ORDER BY id DESC').all(team);
  } else {
    rows = db.prepare(`SELECT j.* FROM jobs j
      JOIN job_assignments a ON a.job_id = j.id
      WHERE a.user_id = ? ORDER BY j.id DESC`).all(id);
  }
  res.json(rows.map(j => serializeJob(j, role)));
});

/* My jobs for today — THIS is the gated endpoint. */
router.get('/mine', gateJobList, (req, res) => {
  const rows = db.prepare(`SELECT j.* FROM jobs j
    JOIN job_assignments a ON a.job_id = j.id
    WHERE a.user_id = ? AND j.stage NOT IN ('Approved')
    ORDER BY (j.stage='Done') ASC, j.id DESC`).all(req.user.id);
  res.json(rows.map(j => serializeJob(j, req.user.role)));
});

/* Create — admins only (they own billing). */
router.post('/', requireAdmin, (req, res) => {
  const b = req.body || {};
  const r = db.prepare(`INSERT INTO jobs (job_no,ref_no,client,team,stage,task,brief,billing,due_date,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    b.job_no || '', b.ref_no || '', b.client || '', b.team || '', b.stage || 'Pipeline',
    b.task || '', b.brief || '', Math.max(0, parseInt(b.billing) || 0), b.due_date || '', req.user.id);
  res.json(serializeJob(getJob(r.lastInsertRowid), req.user.role));
});

/* Edit. Admins can edit anything incl. billing. Team leads can edit
   their team's job fields but NOT billing. */
router.put('/:id', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.user.role === 'team_lead' && job.team !== req.user.team)
    return res.status(403).json({ error: "Not your team's job." });
  const b = req.body || {};
  const fields = ['job_no', 'ref_no', 'client', 'team', 'stage', 'task', 'brief', 'due_date'];
  const sets = [], vals = [];
  fields.forEach(f => { if (f in b) { sets.push(`${f}=?`); vals.push(b[f]); } });
  if ('billing' in b && isAdmin(req.user.role)) { sets.push('billing=?'); vals.push(Math.max(0, parseInt(b.billing) || 0)); }
  if (!sets.length) return res.json(serializeJob(job, req.user.role));
  vals.push(job.id);
  db.prepare(`UPDATE jobs SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json(serializeJob(getJob(job.id), req.user.role));
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* Assign / unassign a member — team leads (their team) and admins. */
router.post('/:id/assign', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.user.role === 'team_lead' && job.team !== req.user.team)
    return res.status(403).json({ error: "You can only assign within your team." });
  const { user_id, role_on_job } = req.body || {};
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!target) return res.status(404).json({ error: 'Person not found.' });
  db.prepare(`INSERT OR IGNORE INTO job_assignments (job_id,user_id,role_on_job,assigned_by) VALUES (?,?,?,?)`)
    .run(job.id, user_id, role_on_job || target.job_role || '', req.user.id);
  res.json(serializeJob(getJob(job.id), req.user.role));
});

router.post('/:id/unassign', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.user.role === 'team_lead' && job.team !== req.user.team)
    return res.status(403).json({ error: "You can only manage your team." });
  db.prepare('DELETE FROM job_assignments WHERE job_id = ? AND user_id = ?').run(job.id, req.body.user_id);
  res.json(serializeJob(getJob(job.id), req.user.role));
});

/* Move a job along stages (lead+ for their team, admins anywhere). */
router.post('/:id/stage', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (req.user.role === 'team_lead' && job.team !== req.user.team)
    return res.status(403).json({ error: "Not your team's job." });
  const { stage } = req.body || {};
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown stage.' });
  db.prepare('UPDATE jobs SET stage = ? WHERE id = ?').run(stage, job.id);
  res.json(serializeJob(getJob(job.id), req.user.role));
});

/* Assignee marks their job done & submits it into the approval chain. */
router.post('/:id/submit', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  const assigned = db.prepare('SELECT 1 FROM job_assignments WHERE job_id = ? AND user_id = ?')
    .get(job.id, req.user.id);
  if (!assigned && !isAdmin(req.user.role))
    return res.status(403).json({ error: 'You are not assigned to this job.' });
  db.prepare("UPDATE jobs SET stage='Done', approval_stage='submitted', reject_note='' WHERE id = ?")
    .run(job.id);
  res.json(serializeJob(getJob(job.id), req.user.role));
});

module.exports = router;
