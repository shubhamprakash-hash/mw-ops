/* ============================================================
   Routes: timesheets
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, isAdmin } = require('../db');
const { pendingTimesheetDay } = require('../middleware');

const today = () => new Date().toISOString().slice(0, 10);

/* Gate status — frontend uses this to know whether to show "submit yesterday" banner. */
router.get('/gate', (req, res) => {
  const owed = pendingTimesheetDay(req.user.id, req.user.role);
  res.json({ locked: !!owed, owed_date: owed || null });
});

/* My timesheet entries (optionally for a date). */
router.get('/mine', (req, res) => {
  const date = req.query.date;
  const rows = date
    ? db.prepare(`SELECT t.*, j.job_no, j.brief FROM timesheet_entries t JOIN jobs j ON j.id=t.job_id
        WHERE t.user_id=? AND t.work_date=? ORDER BY t.id DESC`).all(req.user.id, date)
    : db.prepare(`SELECT t.*, j.job_no, j.brief FROM timesheet_entries t JOIN jobs j ON j.id=t.job_id
        WHERE t.user_id=? ORDER BY t.work_date DESC, t.id DESC`).all(req.user.id);
  res.json(rows);
});

/* Whether a given day is already submitted (locked from editing). */
router.get('/submitted', (req, res) => {
  const date = req.query.date || today();
  const sub = db.prepare('SELECT submitted_at FROM daily_submissions WHERE user_id=? AND work_date=?')
    .get(req.user.id, date);
  res.json({ date, submitted: !!sub, submitted_at: sub ? sub.submitted_at : null });
});

/* Log a time entry. Cannot add to an already-submitted day. */
router.post('/', (req, res) => {
  const { job_id, hours, work_date, note } = req.body || {};
  const date = work_date || today();
  const h = parseFloat(hours);
  if (!job_id || !(h > 0)) return res.status(400).json({ error: 'Pick a job and enter hours > 0.' });
  const locked = db.prepare('SELECT 1 FROM daily_submissions WHERE user_id=? AND work_date=?')
    .get(req.user.id, date);
  if (locked) return res.status(409).json({ error: `${date} is already submitted and locked.` });
  // members may only log against jobs they're assigned to
  if (!isAdmin(req.user.role) && req.user.role !== 'team_lead') {
    const ok = db.prepare('SELECT 1 FROM job_assignments WHERE job_id=? AND user_id=?').get(job_id, req.user.id);
    if (!ok) return res.status(403).json({ error: 'You are not assigned to that job.' });
  }
  const r = db.prepare('INSERT INTO timesheet_entries (user_id,job_id,work_date,hours,note) VALUES (?,?,?,?,?)')
    .run(req.user.id, job_id, date, h, note || '');
  res.json({ id: r.lastInsertRowid });
});

router.delete('/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM timesheet_entries WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Entry not found.' });
  if (e.user_id !== req.user.id && !isAdmin(req.user.role))
    return res.status(403).json({ error: 'Not your entry.' });
  const locked = db.prepare('SELECT 1 FROM daily_submissions WHERE user_id=? AND work_date=?')
    .get(e.user_id, e.work_date);
  if (locked && !isAdmin(req.user.role))
    return res.status(409).json({ error: 'That day is submitted and locked.' });
  db.prepare('DELETE FROM timesheet_entries WHERE id=?').run(e.id);
  res.json({ ok: true });
});

/* Submit a day — closes it and unlocks the next day's job list. */
router.post('/submit-day', (req, res) => {
  const date = (req.body && req.body.work_date) || today();
  const count = db.prepare('SELECT COUNT(*) n FROM timesheet_entries WHERE user_id=? AND work_date=?')
    .get(req.user.id, date).n;
  if (count === 0)
    return res.status(400).json({ error: 'Log at least one entry before submitting the day.' });
  db.prepare('INSERT OR IGNORE INTO daily_submissions (user_id,work_date) VALUES (?,?)')
    .run(req.user.id, date);
  res.json({ ok: true, date, entries: count });
});

module.exports = router;
