/* ============================================================
   Routes: admin (backend) — users, rates, dashboard, P&L
   All endpoints here require admin or super_admin.
   ============================================================ */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, ROLES, OFFICE_DOMAIN } = require('../db');
const { requireAdmin } = require('../middleware');
const { jobCost, jobHours } = require('../helpers');

router.use(requireAdmin); // whole router is backend-only

/* ---------- users ---------- */
router.get('/users', (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.email,u.name,u.role,u.team,u.job_role,u.rate,u.manager_id,u.active,
    m.name AS manager_name,
    (SELECT COALESCE(SUM(hours),0) FROM timesheet_entries WHERE user_id=u.id) AS hours
    FROM users u LEFT JOIN users m ON m.id=u.manager_id ORDER BY u.role, u.name`).all();
  res.json(rows);
});

router.post('/users', (req, res) => {
  const b = req.body || {};
  if (req.user.role !== 'super_admin' && (b.role === 'super_admin' || b.role === 'admin'))
    return res.status(403).json({ error: 'Only a super admin can create admins.' });
  if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Invalid role.' });
  let email = String(b.email || '').trim().toLowerCase();
  if (!email.includes('@')) email = `${email}@${OFFICE_DOMAIN}`;
  if (!email.endsWith('@' + OFFICE_DOMAIN))
    return res.status(400).json({ error: `Email must be @${OFFICE_DOMAIN}.` });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email))
    return res.status(409).json({ error: 'That email already exists.' });
  const tempPw = b.password || Math.random().toString(36).slice(2, 10);
  const r = db.prepare(`INSERT INTO users (email,name,role,team,job_role,rate,manager_id,password_hash,must_change_pw)
    VALUES (?,?,?,?,?,?,?,?,1)`).run(
    email, b.name || email.split('@')[0], b.role, b.team || null, b.job_role || null,
    Math.max(0, parseInt(b.rate) || 0), b.manager_id || null, bcrypt.hashSync(tempPw, 10));
  res.json({ id: r.lastInsertRowid, email, temp_password: tempPw });
});

router.put('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (req.user.role !== 'super_admin' && (u.role === 'super_admin' || u.role === 'admin'))
    return res.status(403).json({ error: 'Only a super admin can edit admins.' });
  const b = req.body || {};
  const fields = ['name', 'role', 'team', 'job_role', 'manager_id', 'active'];
  const sets = [], vals = [];
  fields.forEach(f => { if (f in b) { sets.push(`${f}=?`); vals.push(b[f]); } });
  if ('rate' in b) { sets.push('rate=?'); vals.push(Math.max(0, parseInt(b.rate) || 0)); }
  if (!sets.length) return res.json({ ok: true });
  vals.push(u.id);
  db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const tempPw = Math.random().toString(36).slice(2, 10);
  db.prepare('UPDATE users SET password_hash=?, must_change_pw=1 WHERE id=?')
    .run(bcrypt.hashSync(tempPw, 10), u.id);
  res.json({ temp_password: tempPw });
});

router.delete('/users/:id', (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only.' });
  if (+req.params.id === req.user.id) return res.status(400).json({ error: "You can't delete yourself." });
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id); // soft delete
  res.json({ ok: true });
});

/* ---------- dashboard (money) ---------- */
router.get('/dashboard', (req, res) => {
  const jobs = db.prepare('SELECT * FROM jobs').all();
  let billing = 0, cost = 0, active = 0;
  const byClient = {};
  jobs.forEach(j => {
    const c = jobCost(j.id); billing += j.billing; cost += c;
    if (j.stage !== 'Approved' && j.stage !== 'Done') active++;
    const cl = j.client || '—';
    byClient[cl] = byClient[cl] || { client: cl, billing: 0, cost: 0 };
    byClient[cl].billing += j.billing; byClient[cl].cost += c;
  });
  const hours = db.prepare('SELECT COALESCE(SUM(hours),0) h FROM timesheet_entries').get().h;
  const clients = Object.values(byClient).map(c => ({ ...c, profit: c.billing - c.cost }));
  const stageCount = {};
  db.prepare('SELECT stage, COUNT(*) n FROM jobs GROUP BY stage').all().forEach(r => stageCount[r.stage] = r.n);
  res.json({
    billing, cost, profit: billing - cost, margin: billing ? (billing - cost) / billing * 100 : 0,
    hours, jobs: jobs.length, active,
    clients: clients.sort((a, b) => b.billing - a.billing),
    stageCount,
  });
});

/* ---------- P&L ---------- */
router.get('/pnl', (req, res) => {
  const mode = req.query.mode === 'job' ? 'job' : 'client';
  if (mode === 'job') {
    const rows = db.prepare('SELECT * FROM jobs ORDER BY id DESC').all().map(j => {
      const cost = jobCost(j.id);
      return { name: j.job_no, sub: j.brief, client: j.client, billing: j.billing,
        cost, hours: jobHours(j.id), profit: j.billing - cost,
        margin: j.billing ? (j.billing - cost) / j.billing * 100 : 0 };
    });
    return res.json({ mode, rows });
  }
  const m = {};
  db.prepare('SELECT * FROM jobs').all().forEach(j => {
    const c = j.client || '—';
    m[c] = m[c] || { name: c, jobs: 0, billing: 0, cost: 0, hours: 0 };
    m[c].jobs++; m[c].billing += j.billing; m[c].cost += jobCost(j.id); m[c].hours += jobHours(j.id);
  });
  const rows = Object.values(m).map(r => ({ ...r, profit: r.billing - r.cost,
    margin: r.billing ? (r.billing - r.cost) / r.billing * 100 : 0 }));
  res.json({ mode, rows });
});

module.exports = router;
