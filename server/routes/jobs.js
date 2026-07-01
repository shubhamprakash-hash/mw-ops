/* ============================================================
   Routes: jobs (+ subtasks, attachments, brief versions)
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, isBackend, STAGES } = require('../db');
const { requireBackend, requireRole, gateJobList } = require('../middleware');
const { serializeJob, teamNamesLedBy, jobTeamNames, jobTeamIds, nextJobNumber, formatJobNo, notify, logActivity } = require('../helpers');

const getJob = id => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
const today = () => new Date().toISOString().slice(0, 10);

/* a job's team names, falling back to the legacy single-team field */
const teamNamesOfJob = job => { const t = jobTeamNames(job.id); return t.length ? t : (job.team ? [job.team] : []); };
function leadOwnsTeam(req, job) {
  if (req.user.role !== 'team_lead') return true;
  const led = teamNamesLedBy(req.user.id);
  return teamNamesOfJob(job).some(n => led.includes(n));
}
/* replace a job's team set; keep jobs.team as the primary (first) team for display */
function setJobTeams(jobId, teamIds) {
  db.prepare('DELETE FROM job_teams WHERE job_id=?').run(jobId);
  const ins = db.prepare('INSERT OR IGNORE INTO job_teams (job_id,team_id) VALUES (?,?)');
  (teamIds || []).map(Number).filter(Boolean).forEach(tid => ins.run(jobId, tid));
}
const teamName = tid => { const t = tid && db.prepare('SELECT name FROM teams WHERE id=?').get(+tid); return t ? t.name : ''; };
function resolveTeamIds(b) {
  if (Array.isArray(b.team_ids) && b.team_ids.length) return b.team_ids.map(Number).filter(Boolean);
  if (b.team) { const t = db.prepare('SELECT id FROM teams WHERE name=?').get(b.team); return t ? [t.id] : []; }
  return [];
}
const leadIdsOfJob = jobId => db.prepare(
  `SELECT DISTINCT lead_id FROM teams WHERE id IN (${jobTeamIds(jobId).map(() => '?').join(',') || '0'}) AND lead_id IS NOT NULL`
).all(...jobTeamIds(jobId)).map(r => r.lead_id);
const isAssigned = (jobId, userId) =>
  !!db.prepare('SELECT 1 FROM job_assignments WHERE job_id=? AND user_id=?').get(jobId, userId);
/* who may attach files / toggle subtasks: backend, a lead of the team, or an assignee */
function canTouchJob(req, job) {
  if (isBackend(req.user.role)) return true;
  if (req.user.role === 'team_lead' && leadOwnsTeam(req, job)) return true;
  return isAssigned(job.id, req.user.id);
}
const assigneeIds = jobId =>
  db.prepare('SELECT user_id FROM job_assignments WHERE job_id=?').all(jobId).map(r => r.user_id);
const teamLeadId = teamName => {
  const t = db.prepare('SELECT lead_id FROM teams WHERE name=? AND active=1').get(teamName);
  return t ? t.lead_id : null;
};

/* ---------------- board / lists ---------------- */
router.get('/', (req, res) => {
  const { role, id } = req.user;
  let rows;
  if (isBackend(role)) {
    rows = db.prepare('SELECT * FROM jobs ORDER BY id DESC').all();
  } else if (role === 'team_lead') {
    rows = db.prepare(`SELECT DISTINCT j.* FROM jobs j
      JOIN job_teams jt ON jt.job_id = j.id
      JOIN teams t ON t.id = jt.team_id
      WHERE t.lead_id = ? ORDER BY j.id DESC`).all(id);
  } else {
    rows = db.prepare(`SELECT j.* FROM jobs j JOIN job_assignments a ON a.job_id = j.id
      WHERE a.user_id = ? ORDER BY j.id DESC`).all(id);
  }
  res.json(rows.map(j => serializeJob(j, req.user)));
});

router.get('/mine', gateJobList, (req, res) => {
  const rows = db.prepare(`SELECT j.* FROM jobs j JOIN job_assignments a ON a.job_id = j.id
    WHERE a.user_id = ? AND j.stage NOT IN ('Approved')
    ORDER BY (j.stage='Done') ASC, j.id DESC`).all(req.user.id);
  res.json(rows.map(j => serializeJob(j, req.user)));
});

/* single job (anyone who can see it) */
router.get('/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!isBackend(req.user.role) && !leadOwnsTeam(req, job) && !isAssigned(job.id, req.user.id))
    return res.status(403).json({ error: 'Not your job.' });
  res.json(serializeJob(job, req.user));
});

/* ---------------- create ----------------
   Auto-generates the structured job number + job date. Billing super-only. */
router.post('/', requireBackend, (req, res) => {
  const b = req.body || {};
  const billing = req.user.role === 'super_admin' ? Math.max(0, parseInt(b.billing) || 0) : 0;
  const cl = b.client_id ? db.prepare('SELECT name FROM clients WHERE id = ?').get(b.client_id) : null;
  const num = nextJobNumber(b.client_id || null);
  const teamIds = resolveTeamIds(b);
  const primary = teamIds.length ? teamName(teamIds[0]) : (b.team || '');
  const r = db.prepare(`INSERT INTO jobs
    (job_no,ref_no,job_year,serial,job_seq,round,client,client_id,vertical_id,team,stage,
     workflow_stage_id,task,brief,billing,job_date,due_date,delivery_date,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    num.job_no, b.ref_no || '', num.job_year, num.serial, num.job_seq, num.round,
    cl ? cl.name : (b.client || ''), b.client_id || null, b.vertical_id || null,
    primary, b.stage || 'Pipeline', b.workflow_stage_id || null, b.task || '',
    b.brief || '', billing, today(), b.due_date || '', b.delivery_date || '', req.user.id);
  const id = r.lastInsertRowid;
  setJobTeams(id, teamIds);
  if ((b.brief || '').trim())
    db.prepare('INSERT INTO brief_versions (job_id,brief,edited_by) VALUES (?,?,?)').run(id, b.brief, req.user.id);
  logActivity({ actor: req.user, entity_type: 'job', entity_id: id, job_id: id, action: 'created',
    new_value: num.job_no, note: b.brief || '' });
  res.json(serializeJob(getJob(id), req.user));
});

/* ---------------- edit ----------------
   Snapshots the brief into history whenever it changes. Billing super-only. */
router.put('/:id', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!leadOwnsTeam(req, job)) return res.status(403).json({ error: "Not your team's job." });
  const b = req.body || {};
  const fields = ['ref_no', 'client', 'client_id', 'vertical_id', 'team', 'stage',
    'workflow_stage_id', 'task', 'brief', 'due_date', 'delivery_date'];
  const sets = [], vals = [], changed = [];
  fields.forEach(f => { if (f in b) { sets.push(`${f}=?`); vals.push(b[f]); if (String(b[f]) !== String(job[f] ?? '')) changed.push(f); } });
  if ('billing' in b && req.user.role === 'super_admin') { sets.push('billing=?'); vals.push(Math.max(0, parseInt(b.billing) || 0)); }
  // brief version snapshot (keep the NEW text as a version when it actually changes)
  if ('brief' in b && (b.brief || '') !== (job.brief || ''))
    db.prepare('INSERT INTO brief_versions (job_id,brief,edited_by) VALUES (?,?,?)').run(job.id, b.brief || '', req.user.id);
  // multiple teams: replace the set and keep team=primary for display
  if ('team_ids' in b) {
    const tids = (Array.isArray(b.team_ids) ? b.team_ids : []).map(Number).filter(Boolean);
    setJobTeams(job.id, tids);
    const primary = tids.length ? teamName(tids[0]) : '';
    db.prepare('UPDATE jobs SET team=? WHERE id=?').run(primary, job.id);
    changed.push('teams');
  }
  if (sets.length) { vals.push(job.id); db.prepare(`UPDATE jobs SET ${sets.join(',')} WHERE id=?`).run(...vals); }
  if (changed.length)
    logActivity({ actor: req.user, entity_type: 'job', entity_id: job.id, job_id: job.id, action: 'updated',
      field: changed.join(', '), note: job.job_no });
  res.json(serializeJob(getJob(job.id), req.user));
});

router.delete('/:id', requireBackend, (req, res) => {
  const job = getJob(req.params.id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  if (job) logActivity({ actor: req.user, entity_type: 'job', entity_id: job.id, job_id: null, action: 'deleted', note: job.job_no });
  res.json({ ok: true });
});

/* ---------------- round increment (re-assignment after client feedback) ---------------- */
router.post('/:id/round', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!leadOwnsTeam(req, job)) return res.status(403).json({ error: "Not your team's job." });
  const round = (job.round || 1) + 1;
  const job_no = formatJobNo({ job_year: job.job_year, serial: job.serial, job_seq: job.job_seq, round });
  db.prepare("UPDATE jobs SET round=?, job_no=?, stage='Pending', approval_stage='none', reject_note='' WHERE id=?")
    .run(round, job_no, job.id);
  notify(assigneeIds(job.id), `${job_no} is back for round R${round} (client feedback) — ${job.client}`, 'round', job.id);
  logActivity({ actor: req.user, entity_type: 'round', entity_id: job.id, job_id: job.id, action: 'round',
    old_value: 'R' + (job.round || 1), new_value: 'R' + round, note: job_no });
  res.json(serializeJob(getJob(job.id), req.user));
});

/* ---------------- assignment ---------------- */
router.post('/:id/assign', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!leadOwnsTeam(req, job)) return res.status(403).json({ error: 'You can only assign within your team.' });
  const { user_id, role_on_job } = req.body || {};
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!target) return res.status(404).json({ error: 'Person not found.' });
  const existed = isAssigned(job.id, user_id);
  db.prepare('INSERT OR IGNORE INTO job_assignments (job_id,user_id,role_on_job,assigned_by) VALUES (?,?,?,?)')
    .run(job.id, user_id, role_on_job || target.job_role || '', req.user.id);
  if (!existed) {
    notify(user_id, `You were assigned to ${job.job_no} (${job.client}) — ${job.brief || 'new job'}`, 'assigned', job.id);
    logActivity({ actor: req.user, entity_type: 'assignment', entity_id: job.id, job_id: job.id, action: 'assigned',
      new_value: target.name, note: job.job_no });
  }
  res.json(serializeJob(getJob(job.id), req.user));
});

router.post('/:id/unassign', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!leadOwnsTeam(req, job)) return res.status(403).json({ error: 'You can only manage your team.' });
  const target = db.prepare('SELECT name FROM users WHERE id=?').get(req.body.user_id);
  db.prepare('DELETE FROM job_assignments WHERE job_id = ? AND user_id = ?').run(job.id, req.body.user_id);
  logActivity({ actor: req.user, entity_type: 'assignment', entity_id: job.id, job_id: job.id, action: 'unassigned',
    old_value: target ? target.name : '', note: job.job_no });
  res.json(serializeJob(getJob(job.id), req.user));
});

router.post('/:id/stage', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!leadOwnsTeam(req, job)) return res.status(403).json({ error: "Not your team's job." });
  const { stage } = req.body || {};
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown stage.' });
  db.prepare('UPDATE jobs SET stage = ? WHERE id = ?').run(stage, job.id);
  logActivity({ actor: req.user, entity_type: 'job', entity_id: job.id, job_id: job.id, action: 'stage',
    field: 'stage', old_value: job.stage, new_value: stage, note: job.job_no });
  res.json(serializeJob(getJob(job.id), req.user));
});

/* Assignee marks a job done & submits it into the approval chain; notify the team lead. */
router.post('/:id/submit', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!isAssigned(job.id, req.user.id) && !isBackend(req.user.role))
    return res.status(403).json({ error: 'You are not assigned to this job.' });
  db.prepare("UPDATE jobs SET stage='Done', approval_stage='submitted', reject_note='' WHERE id = ?").run(job.id);
  const leads = leadIdsOfJob(job.id).filter(l => l && l !== req.user.id);
  if (leads.length)
    notify(leads, `${job.job_no} (${job.client}) is awaiting your approval`, 'approval', job.id);
  logActivity({ actor: req.user, entity_type: 'job', entity_id: job.id, job_id: job.id, action: 'submitted', note: job.job_no });
  res.json(serializeJob(getJob(job.id), req.user));
});

/* ================= sub-tasks ================= */
function subtaskRow(s) {
  const a = s.assignee_id ? db.prepare('SELECT name FROM users WHERE id=?').get(s.assignee_id) : null;
  return { id: s.id, title: s.title, done: !!s.done, assignee_id: s.assignee_id, assignee: a ? a.name : null, position: s.position };
}
router.get('/:id/subtasks', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(db.prepare('SELECT * FROM subtasks WHERE job_id=? ORDER BY position, id').all(job.id).map(subtaskRow));
});
router.post('/:id/subtasks', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!leadOwnsTeam(req, job)) return res.status(403).json({ error: "Not your team's job." });
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title required.' });
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM subtasks WHERE job_id=?').get(job.id).p;
  const r = db.prepare('INSERT INTO subtasks (job_id,title,assignee_id,position,created_by) VALUES (?,?,?,?,?)')
    .run(job.id, title, req.body.assignee_id || null, pos, req.user.id);
  if (req.body.assignee_id)
    notify(req.body.assignee_id, `New sub-task on ${job.job_no}: ${title}`, 'subtask', job.id);
  logActivity({ actor: req.user, entity_type: 'subtask', entity_id: r.lastInsertRowid, job_id: job.id, action: 'created', new_value: title, note: job.job_no });
  res.json(subtaskRow(db.prepare('SELECT * FROM subtasks WHERE id=?').get(r.lastInsertRowid)));
});
router.put('/:id/subtasks/:sid', (req, res) => {
  const job = getJob(req.params.id);
  const st = db.prepare('SELECT * FROM subtasks WHERE id=? AND job_id=?').get(req.params.sid, req.params.id);
  if (!job || !st) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  const editingMeta = ('title' in b) || ('assignee_id' in b);
  const lead = isBackend(req.user.role) || (req.user.role === 'team_lead' && leadOwnsTeam(req, job));
  // toggling "done" is allowed for an assignee of the job; editing title/assignee needs lead+
  if (editingMeta && !lead) return res.status(403).json({ error: 'Only a lead can edit sub-tasks.' });
  if (!lead && !isAssigned(job.id, req.user.id)) return res.status(403).json({ error: 'Not your job.' });
  const sets = [], vals = [];
  if ('title' in b) { sets.push('title=?'); vals.push((b.title || '').trim()); }
  if ('assignee_id' in b) { sets.push('assignee_id=?'); vals.push(b.assignee_id || null); }
  if ('done' in b) { sets.push('done=?'); vals.push(b.done ? 1 : 0); }
  if (sets.length) { vals.push(st.id); db.prepare(`UPDATE subtasks SET ${sets.join(',')} WHERE id=?`).run(...vals); }
  if ('done' in b)
    logActivity({ actor: req.user, entity_type: 'subtask', entity_id: st.id, job_id: job.id,
      action: 'updated', field: 'done', new_value: b.done ? 'done' : 'reopened', note: st.title });
  res.json(subtaskRow(db.prepare('SELECT * FROM subtasks WHERE id=?').get(st.id)));
});
router.delete('/:id/subtasks/:sid', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!leadOwnsTeam(req, job)) return res.status(403).json({ error: "Not your team's job." });
  const st = db.prepare('SELECT title FROM subtasks WHERE id=? AND job_id=?').get(req.params.sid, job.id);
  db.prepare('DELETE FROM subtasks WHERE id=? AND job_id=?').run(req.params.sid, job.id);
  if (st) logActivity({ actor: req.user, entity_type: 'subtask', entity_id: +req.params.sid, job_id: job.id, action: 'deleted', note: st.title });
  res.json({ ok: true });
});

/* ================= attachments (brief PDFs etc.) ================= */
router.get('/:id/attachments', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(db.prepare(`SELECT a.id,a.filename,a.mime,a.size,a.created_at,u.name AS uploaded_by
    FROM attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.job_id=? ORDER BY a.id DESC`).all(job.id));
});
router.post('/:id/attachments', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!canTouchJob(req, job)) return res.status(403).json({ error: 'Not your job.' });
  const { filename, mime, content_b64 } = req.body || {};
  if (!filename || !content_b64) return res.status(400).json({ error: 'filename and content required.' });
  const size = Math.floor((content_b64.length * 3) / 4);
  if (size > 12 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max 12 MB).' });
  const r = db.prepare(`INSERT INTO attachments (job_id,filename,mime,size,content_b64,uploaded_by)
    VALUES (?,?,?,?,?,?)`).run(job.id, filename, mime || 'application/octet-stream', size, content_b64, req.user.id);
  logActivity({ actor: req.user, entity_type: 'attachment', entity_id: r.lastInsertRowid, job_id: job.id, action: 'created', new_value: filename, note: job.job_no });
  res.json({ id: r.lastInsertRowid, filename, mime: mime || 'application/octet-stream', size });
});
router.get('/:id/attachments/:aid/download', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!isBackend(req.user.role) && !leadOwnsTeam(req, job) && !isAssigned(job.id, req.user.id))
    return res.status(403).json({ error: 'Not your job.' });
  const a = db.prepare('SELECT * FROM attachments WHERE id=? AND job_id=?').get(req.params.aid, job.id);
  if (!a) return res.status(404).json({ error: 'Attachment not found.' });
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${a.filename.replace(/"/g, '')}"`);
  res.send(Buffer.from(a.content_b64, 'base64'));
});
router.delete('/:id/attachments/:aid', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  const a = db.prepare('SELECT * FROM attachments WHERE id=? AND job_id=?').get(req.params.aid, job.id);
  if (!a) return res.status(404).json({ error: 'Attachment not found.' });
  const lead = isBackend(req.user.role) || (req.user.role === 'team_lead' && leadOwnsTeam(req, job));
  if (!lead && a.uploaded_by !== req.user.id) return res.status(403).json({ error: 'Only the uploader or a lead can remove this.' });
  db.prepare('DELETE FROM attachments WHERE id=?').run(a.id);
  logActivity({ actor: req.user, entity_type: 'attachment', entity_id: a.id, job_id: job.id, action: 'deleted', old_value: a.filename, note: job.job_no });
  res.json({ ok: true });
});

/* ================= brief version history ================= */
router.get('/:id/brief-versions', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(db.prepare(`SELECT bv.id,bv.brief,bv.created_at,u.name AS edited_by
    FROM brief_versions bv LEFT JOIN users u ON u.id=bv.edited_by
    WHERE bv.job_id=? ORDER BY bv.id DESC`).all(job.id));
});

module.exports = router;
