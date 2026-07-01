/* ============================================================
   Routes: notifications (the bell) — per-user, auth required
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db } = require('../db');

/* recent notifications for the signed-in user */
router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT id, kind, message, job_id, read, created_at
    FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50`).all(req.user.id);
  res.json(rows.map(n => ({ ...n, read: !!n.read })));
});

/* unread count for the badge */
router.get('/count', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0').get(req.user.id).n;
  res.json({ count: n });
});

/* mark one read */
router.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* mark all read */
router.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=? AND read=0').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
