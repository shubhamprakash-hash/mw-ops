/* ============================================================
   Routes: approvals (lead -> admin -> super_admin)
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, isAdmin, LEVEL_FOR_ROLE, NEXT_APPROVAL } = require('../db');
const { serializeJob } = require('../helpers');

const LEVEL_NAME = { team_lead: 'lead', admin: 'admin', super_admin: 'super' };

/* The queue this user is responsible for, at their stage of the chain. */
router.get('/queue', (req, res) => {
  const stage = LEVEL_FOR_ROLE[req.user.role];
  if (!stage) return res.json([]); // members have no queue
  let rows;
  if (req.user.role === 'team_lead') {
    rows = db.prepare(`SELECT * FROM jobs WHERE approval_stage=? AND team=? ORDER BY id`)
      .all(stage, req.user.team);
  } else {
    rows = db.prepare(`SELECT * FROM jobs WHERE approval_stage=? ORDER BY id`).all(stage);
  }
  res.json(rows.map(j => {
    const out = serializeJob(j, req.user.role);
    out.timesheet = db.prepare(`
      SELECT t.hours, t.work_date, t.note, u.name FROM timesheet_entries t
      JOIN users u ON u.id=t.user_id WHERE t.job_id=? ORDER BY t.work_date`).all(j.id);
    return out;
  }));
});

/* How many items are waiting on me (for the nav badge). */
router.get('/count', (req, res) => {
  const stage = LEVEL_FOR_ROLE[req.user.role];
  if (!stage) return res.json({ count: 0 });
  const q = req.user.role === 'team_lead'
    ? db.prepare('SELECT COUNT(*) n FROM jobs WHERE approval_stage=? AND team=?').get(stage, req.user.team)
    : db.prepare('SELECT COUNT(*) n FROM jobs WHERE approval_stage=?').get(stage);
  res.json({ count: q.n });
});

/* Approve — advance to the next level (or fully Approved at super). */
router.post('/:id/approve', (req, res) => {
  const stage = LEVEL_FOR_ROLE[req.user.role];
  if (!stage) return res.status(403).json({ error: 'You cannot approve.' });
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (job.approval_stage !== stage)
    return res.status(409).json({ error: 'This job is not at your approval stage.' });
  if (req.user.role === 'team_lead' && job.team !== req.user.team)
    return res.status(403).json({ error: "Not your team's job." });

  const next = NEXT_APPROVAL[stage];           // submitted->lead_approved->admin_approved->approved
  const fullyDone = next === 'approved';
  db.prepare('UPDATE jobs SET approval_stage=?, stage=? WHERE id=?')
    .run(next, fullyDone ? 'Approved' : job.stage, job.id);
  db.prepare('INSERT INTO approvals (job_id,level,approver_id,action,note) VALUES (?,?,?,?,?)')
    .run(job.id, LEVEL_NAME[req.user.role], req.user.id, 'approved', (req.body && req.body.note) || '');
  res.json(serializeJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id), req.user.role));
});

/* Reject — send the job back to the assignee with a note. */
router.post('/:id/reject', (req, res) => {
  const stage = LEVEL_FOR_ROLE[req.user.role];
  if (!stage) return res.status(403).json({ error: 'You cannot reject.' });
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (job.approval_stage !== stage)
    return res.status(409).json({ error: 'This job is not at your approval stage.' });
  if (req.user.role === 'team_lead' && job.team !== req.user.team)
    return res.status(403).json({ error: "Not your team's job." });
  const note = (req.body && req.body.note) || 'Sent back for rework.';
  db.prepare("UPDATE jobs SET approval_stage='rejected', stage='Pending', reject_note=? WHERE id=?")
    .run(note, job.id);
  db.prepare('INSERT INTO approvals (job_id,level,approver_id,action,note) VALUES (?,?,?,?,?)')
    .run(job.id, LEVEL_NAME[req.user.role], req.user.id, 'rejected', note);
  res.json(serializeJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id), req.user.role));
});

/* History trail for one job. */
router.get('/:id/history', (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.name approver FROM approvals a
    LEFT JOIN users u ON u.id=a.approver_id WHERE a.job_id=? ORDER BY a.id`).all(req.params.id);
  res.json(rows);
});

module.exports = router;
