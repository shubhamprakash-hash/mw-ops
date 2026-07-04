/* ============================================================
   Routes: users (backend user management)
   Mounted under requireBackend. Cost-rate endpoints require super.
   ============================================================ */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, ROLES, isSuper, OFFICE_DOMAIN } = require('../db');
const { requireSuper } = require('../middleware');
const { currentRate } = require('../helpers');

/* List people with role, department, teams, manager, hours (+ current cost rate for super). */
router.get('/', (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.email,u.name,u.role,u.job_role,u.department_id,u.reports_to,u.active,
    d.name AS department, m.name AS manager_name,
    (SELECT GROUP_CONCAT(t.name,', ') FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=u.id) AS teams,
    (SELECT COALESCE(SUM(hours),0) FROM timesheet_entries WHERE user_id=u.id) AS hours
    FROM users u
    LEFT JOIN departments d ON d.id=u.department_id
    LEFT JOIN users m ON m.id=u.reports_to
    ORDER BY u.role, u.name`).all();
  const sup = isSuper(req.user.role);
  res.json(rows.map(r => sup ? { ...r, rate: currentRate(r.id) } : r));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Invalid role.' });
  if (!isSuper(req.user.role) && (b.role === 'super_admin' || b.role === 'admin'))
    return res.status(403).json({ error: 'Only a super admin can create admins.' });
  let email = String(b.email || '').trim().toLowerCase();
  if (!email.includes('@')) email = `${email}@${OFFICE_DOMAIN}`;
  if (!email.endsWith('@' + OFFICE_DOMAIN)) return res.status(400).json({ error: `Email must be @${OFFICE_DOMAIN}.` });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'That email already exists.' });
  const tempPw = b.password || Math.random().toString(36).slice(2, 10);
  const r = db.prepare(`INSERT INTO users (email,name,role,job_role,department_id,reports_to,password_hash,must_change_pw)
    VALUES (?,?,?,?,?,?,?,1)`).run(
    email, b.name || email.split('@')[0], b.role, b.job_role || null,
    b.department_id || null, b.reports_to || null, bcrypt.hashSync(tempPw, 10));
  const uid = r.lastInsertRowid;
  // optional team memberships
  (b.team_ids || []).forEach(tid => db.prepare('INSERT OR IGNORE INTO team_members (team_id,user_id) VALUES (?,?)').run(tid, uid));
  // optional initial cost rate (super only)
  if (isSuper(req.user.role) && b.rate) {
    db.prepare('INSERT INTO cost_rates (user_id,cost_per_hour,effective_from,created_by) VALUES (?,?,?,?)')
      .run(uid, Math.max(0, parseInt(b.rate) || 0), b.rate_from || new Date().toISOString().slice(0, 10), req.user.id);
  }
  res.json({ id: uid, email, temp_password: tempPw });
});

router.put('/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (!isSuper(req.user.role) && (u.role === 'super_admin' || u.role === 'admin'))
    return res.status(403).json({ error: 'Only a super admin can edit admins.' });
  const b = req.body || {};
  if (b.role && !isSuper(req.user.role) && (b.role === 'super_admin' || b.role === 'admin'))
    return res.status(403).json({ error: 'Only a super admin can grant admin roles.' });
  const sets = [], vals = [];
  ['name', 'role', 'job_role', 'department_id', 'reports_to', 'active'].forEach(f => { if (f in b) { sets.push(`${f}=?`); vals.push(b[f]); } });
  if (sets.length) { vals.push(u.id); db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...vals); }
  // team membership replacement (optional)
  if (Array.isArray(b.team_ids)) {
    db.prepare('DELETE FROM team_members WHERE user_id=?').run(u.id);
    b.team_ids.forEach(tid => db.prepare('INSERT OR IGNORE INTO team_members (team_id,user_id) VALUES (?,?)').run(tid, u.id));
  }
  res.json({ ok: true });
});

router.post('/:id/reset-password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const tempPw = Math.random().toString(36).slice(2, 10);
  db.prepare('UPDATE users SET password_hash=?, must_change_pw=1 WHERE id=?').run(bcrypt.hashSync(tempPw, 10), u.id);
  res.json({ temp_password: tempPw });
});

router.delete('/:id', (req, res) => {
  if (!isSuper(req.user.role)) return res.status(403).json({ error: 'Super admin only.' });
  if (+req.params.id === req.user.id) return res.status(400).json({ error: "You can't deactivate yourself." });
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---- dated cost rates (SUPER ONLY) ---- */
router.get('/:id/rates', requireSuper, (req, res) => {
  res.json(db.prepare(`SELECT cr.*, u.name AS by_name FROM cost_rates cr
    LEFT JOIN users u ON u.id=cr.created_by WHERE cr.user_id=? ORDER BY date(cr.effective_from) DESC, cr.id DESC`).all(req.params.id));
});
router.post('/:id/rates', requireSuper, (req, res) => {
  const b = req.body || {};
  const rate = Math.max(0, parseInt(b.cost_per_hour) || 0);
  const from = b.effective_from || new Date().toISOString().slice(0, 10);
  // One rate per person per effective date: setting a rate on a date that already
  // has one replaces it (keeps history clean and the effective rate unambiguous).
  db.prepare(`INSERT INTO cost_rates (user_id,cost_per_hour,effective_from,created_by)
    VALUES (?,?,?,?)
    ON CONFLICT(user_id,effective_from) DO UPDATE SET
      cost_per_hour=excluded.cost_per_hour, created_by=excluded.created_by, created_at=datetime('now')`)
    .run(req.params.id, rate, from, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
