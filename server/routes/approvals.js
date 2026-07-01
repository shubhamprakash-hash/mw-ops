/* ============================================================
   Routes: approvals (lead -> admin -> super_admin)
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, LEVEL_FOR_ROLE, NEXT_APPROVAL } = require('../db');
const { serializeJob, teamNamesLedBy, jobTeamNames, notify, usersByRole, logActivity } = require('../helpers');

const LEVEL_NAME = { team_lead: 'lead', admin: 'admin', super_admin: 'super' };
const assigneeIds = jobId =>
  db.prepare('SELECT user_id FROM job_assignments WHERE job_id=?').all(jobId).map(r => r.user_id);
const leadOnJob = (userId, jobId) => {
  const led = teamNamesLedBy(userId);
  return jobTeamNames(jobId).some(n => led.includes(n));
};

function queueRows(user) {
  const stage = LEVEL_FOR_ROLE[user.role];
  if (!stage) return [];
  if (user.role === 'team_lead') {
    return db.prepare(`SELECT DISTINCT j.* FROM jobs j
      JOIN job_teams jt ON jt.job_id=j.id JOIN teams t ON t.id=jt.team_id
      WHERE j.approval_stage=? AND t.lead_id=? ORDER BY j.id`).all(stage, user.id);
  }
  return db.prepare('SELECT * FROM jobs WHERE approval_stage=? ORDER BY id').all(stage);
}

router.get('/queue', (req, res) => {
  res.json(queueRows(req.user).map(j => {
    const out = serializeJob(j, req.user);
    out.timesheet = db.prepare(`SELECT t.hours, t.work_date, t.note, u.name FROM timesheet_entries t
      JOIN users u ON u.id=t.user_id WHERE t.job_id=? ORDER BY t.work_date`).all(j.id);
    return out;
  }));
});

router.get('/count', (req, res) => res.json({ count: queueRows(req.user).length }));

function actGuard(req, res) {
  const stage = LEVEL_FOR_ROLE[req.user.role];
  if (!stage) { res.status(403).json({ error: 'You cannot act on approvals.' }); return null; }
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) { res.status(404).json({ error: 'Job not found.' }); return null; }
  if (job.approval_stage !== stage) { res.status(409).json({ error: 'This job is not at your approval stage.' }); return null; }
  if (req.user.role === 'team_lead' && !leadOnJob(req.user.id, job.id)) {
    res.status(403).json({ error: "Not your team's job." }); return null;
  }
  return { stage, job };
}

router.post('/:id/approve', (req, res) => {
  const ctx = actGuard(req, res); if (!ctx) return;
  const next = NEXT_APPROVAL[ctx.stage];
  const fullyDone = next === 'approved';
  db.prepare('UPDATE jobs SET approval_stage=?, stage=? WHERE id=?')
    .run(next, fullyDone ? 'Approved' : ctx.job.stage, ctx.job.id);
  db.prepare('INSERT INTO approvals (job_id,level,approver_id,action,note) VALUES (?,?,?,?,?)')
    .run(ctx.job.id, LEVEL_NAME[req.user.role], req.user.id, 'approved', (req.body && req.body.note) || '');
  logActivity({ actor: req.user, entity_type: 'approval', entity_id: ctx.job.id, job_id: ctx.job.id,
    action: 'approved', new_value: fullyDone ? 'approved' : next, note: ctx.job.job_no });
  // notify the next link in the chain (or the team on final approval)
  if (fullyDone) {
    notify(assigneeIds(ctx.job.id), `${ctx.job.job_no} (${ctx.job.client}) was fully approved 🎉`, 'approved', ctx.job.id);
  } else if (next === 'lead_approved') {
    notify(usersByRole('admin'), `${ctx.job.job_no} (${ctx.job.client}) needs your admin approval`, 'approval', ctx.job.id);
  } else if (next === 'admin_approved') {
    notify(usersByRole('super_admin'), `${ctx.job.job_no} (${ctx.job.client}) needs final approval`, 'approval', ctx.job.id);
  }
  res.json(serializeJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(ctx.job.id), req.user));
});

router.post('/:id/reject', (req, res) => {
  const ctx = actGuard(req, res); if (!ctx) return;
  const note = (req.body && req.body.note) || 'Sent back for rework.';
  db.prepare("UPDATE jobs SET approval_stage='rejected', stage='Pending', reject_note=? WHERE id=?")
    .run(note, ctx.job.id);
  db.prepare('INSERT INTO approvals (job_id,level,approver_id,action,note) VALUES (?,?,?,?,?)')
    .run(ctx.job.id, LEVEL_NAME[req.user.role], req.user.id, 'rejected', note);
  logActivity({ actor: req.user, entity_type: 'approval', entity_id: ctx.job.id, job_id: ctx.job.id,
    action: 'rejected', note: note });
  notify(assigneeIds(ctx.job.id), `${ctx.job.job_no} was sent back: ${note}`, 'rejected', ctx.job.id);
  res.json(serializeJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(ctx.job.id), req.user));
});

router.get('/:id/history', (req, res) => {
  res.json(db.prepare(`SELECT a.*, u.name approver FROM approvals a
    LEFT JOIN users u ON u.id=a.approver_id WHERE a.job_id=? ORDER BY a.id`).all(req.params.id));
});

module.exports = router;
