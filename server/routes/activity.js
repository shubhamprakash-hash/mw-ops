/* ============================================================
   Routes: activity — the immutable audit trail (read-only).
   Mounted under requireCap('view_activity') (admin + super by default).
   Filterable by job, user, action, and date range.
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db } = require('../db');

router.get('/', (req, res) => {
  const where = [];
  const args = [];
  if (req.query.job_id) { where.push('a.job_id = ?'); args.push(+req.query.job_id); }
  if (req.query.user_id) { where.push('a.actor_id = ?'); args.push(+req.query.user_id); }
  if (req.query.action) { where.push('a.action = ?'); args.push(String(req.query.action)); }
  if (req.query.entity_type) { where.push('a.entity_type = ?'); args.push(String(req.query.entity_type)); }
  if (req.query.from) { where.push('date(a.created_at) >= date(?)'); args.push(String(req.query.from)); }
  if (req.query.to) { where.push('date(a.created_at) <= date(?)'); args.push(String(req.query.to)); }
  const limit = Math.min(500, Math.max(1, +req.query.limit || 200));
  const sql = `SELECT a.*, j.job_no FROM activity_log a
    LEFT JOIN jobs j ON j.id = a.job_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.id DESC LIMIT ${limit}`;
  const rows = db.prepare(sql).all(...args);
  res.json(rows);
});

// distinct actors + actions, to populate the filter dropdowns
router.get('/filters', (req, res) => {
  res.json({
    users: db.prepare(`SELECT DISTINCT actor_id id, actor_name name FROM activity_log
      WHERE actor_id IS NOT NULL ORDER BY actor_name`).all(),
    actions: db.prepare('SELECT DISTINCT action FROM activity_log ORDER BY action').all().map(r => r.action),
  });
});

module.exports = router;
