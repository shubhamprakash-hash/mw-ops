/* ============================================================
   Routes: masters — verticals, teams, departments, clients
   Backend (admin + super) only, mounted under requireBackend.
   Financial field (client.retainer_cost) is hidden from non-super.
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, isSuper, canSetRetainerCost } = require('../db');
const { customValues, setCustomValues } = require('../helpers');

const inUse = (table, col, id) => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col}=?`).get(id).n > 0;

/* ---------------- Verticals ---------------- */
router.get('/verticals', (req, res) => {
  res.json(db.prepare(`SELECT v.*,
    (SELECT COUNT(*) FROM teams WHERE vertical_id=v.id) AS teams,
    (SELECT COUNT(*) FROM clients WHERE vertical_id=v.id) AS clients
    FROM verticals v ORDER BY v.name`).all());
});
router.post('/verticals', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required.' });
  if (db.prepare('SELECT 1 FROM verticals WHERE name=?').get(name)) return res.status(409).json({ error: 'Already exists.' });
  const r = db.prepare('INSERT INTO verticals (name) VALUES (?)').run(name);
  res.json({ id: r.lastInsertRowid, name });
});
router.put('/verticals/:id', (req, res) => {
  db.prepare('UPDATE verticals SET name=? WHERE id=?').run((req.body.name || '').trim(), req.params.id);
  res.json({ ok: true });
});
router.delete('/verticals/:id', (req, res) => {
  if (inUse('teams', 'vertical_id', req.params.id) || inUse('clients', 'vertical_id', req.params.id))
    return res.status(409).json({ error: 'In use by teams or clients — reassign them first.' });
  db.prepare('DELETE FROM verticals WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Teams ---------------- */
router.get('/teams', (req, res) => {
  res.json(db.prepare(`SELECT t.*, v.name AS vertical, u.name AS lead_name,
    (SELECT COUNT(*) FROM team_members WHERE team_id=t.id) AS members
    FROM teams t LEFT JOIN verticals v ON v.id=t.vertical_id LEFT JOIN users u ON u.id=t.lead_id
    ORDER BY v.name, t.name`).all());
});
router.post('/teams', (req, res) => {
  const b = req.body || {};
  if (!(b.name || '').trim()) return res.status(400).json({ error: 'Name required.' });
  const r = db.prepare('INSERT INTO teams (name,vertical_id,sub_vertical,lead_id) VALUES (?,?,?,?)')
    .run(b.name.trim(), b.vertical_id || null, b.sub_vertical || '', b.lead_id || null);
  res.json({ id: r.lastInsertRowid });
});
router.put('/teams/:id', (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [];
  ['name', 'vertical_id', 'sub_vertical', 'lead_id', 'active'].forEach(f => { if (f in b) { sets.push(`${f}=?`); vals.push(b[f]); } });
  if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE teams SET ${sets.join(',')} WHERE id=?`).run(...vals); }
  res.json({ ok: true });
});
router.delete('/teams/:id', (req, res) => {
  db.prepare('DELETE FROM teams WHERE id=?').run(req.params.id); // cascades team_members
  res.json({ ok: true });
});
router.get('/teams/:id/members', (req, res) => {
  res.json(db.prepare(`SELECT u.id,u.name,u.job_role,u.role FROM team_members tm
    JOIN users u ON u.id=tm.user_id WHERE tm.team_id=? AND u.active=1 ORDER BY u.name`).all(req.params.id));
});
router.post('/teams/:id/members', (req, res) => {
  const uid = req.body.user_id;
  if (!uid) return res.status(400).json({ error: 'user_id required.' });
  db.prepare('INSERT OR IGNORE INTO team_members (team_id,user_id) VALUES (?,?)').run(req.params.id, uid);
  res.json({ ok: true });
});
router.delete('/teams/:id/members/:userId', (req, res) => {
  db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(req.params.id, req.params.userId);
  res.json({ ok: true });
});
/* Move a person from one team to another in a single call. */
router.post('/teams/move', (req, res) => {
  const { user_id, from_team_id, to_team_id } = req.body || {};
  if (!user_id || !to_team_id) return res.status(400).json({ error: 'user_id and to_team_id required.' });
  if (from_team_id) db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(from_team_id, user_id);
  db.prepare('INSERT OR IGNORE INTO team_members (team_id,user_id) VALUES (?,?)').run(to_team_id, user_id);
  res.json({ ok: true });
});

/* ---------------- Departments ---------------- */
router.get('/departments', (req, res) => {
  res.json(db.prepare(`SELECT d.*, v.name AS vertical,
    (SELECT COUNT(*) FROM users WHERE department_id=d.id AND active=1) AS people
    FROM departments d LEFT JOIN verticals v ON v.id=d.vertical_id ORDER BY d.name`).all());
});
router.post('/departments', (req, res) => {
  const b = req.body || {};
  if (!(b.name || '').trim()) return res.status(400).json({ error: 'Name required.' });
  const r = db.prepare('INSERT INTO departments (name,vertical_id) VALUES (?,?)').run(b.name.trim(), b.vertical_id || null);
  res.json({ id: r.lastInsertRowid });
});
router.put('/departments/:id', (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [];
  ['name', 'vertical_id'].forEach(f => { if (f in b) { sets.push(`${f}=?`); vals.push(b[f]); } });
  if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE departments SET ${sets.join(',')} WHERE id=?`).run(...vals); }
  res.json({ ok: true });
});
router.delete('/departments/:id', (req, res) => {
  if (inUse('users', 'department_id', req.params.id))
    return res.status(409).json({ error: 'People are still in this department.' });
  db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Clients ---------------- */
function clientOut(c, role) {
  const o = { id: c.id, name: c.name, type: c.type, vertical_id: c.vertical_id,
    vertical: c.vertical, status: c.status, jobs: c.jobs };
  if (isSuper(role)) o.retainer_cost = c.retainer_cost; // financial — super only
  return o;
}
router.get('/clients', (req, res) => {
  const rows = db.prepare(`SELECT c.*, v.name AS vertical,
    (SELECT COUNT(*) FROM jobs WHERE client_id=c.id) AS jobs
    FROM clients c LEFT JOIN verticals v ON v.id=c.vertical_id ORDER BY c.name`).all();
  res.json(rows.map(c => ({ ...clientOut(c, req.user.role), custom: customValues('client', c.id) })));
});
router.post('/clients', (req, res) => {
  const b = req.body || {};
  if (!(b.name || '').trim()) return res.status(400).json({ error: 'Name required.' });
  const type = b.type === 'retainership' ? 'retainership' : 'project';
  const status = b.status === 'prospective' ? 'prospective' : 'converted';
  const retainer = canSetRetainerCost(req.user.role) ? Math.max(0, parseInt(b.retainer_cost) || 0) : 0;
  const r = db.prepare('INSERT INTO clients (name,type,vertical_id,status,retainer_cost,created_by) VALUES (?,?,?,?,?,?)')
    .run(b.name.trim(), type, b.vertical_id || null, status, retainer, req.user.id);
  setCustomValues('client', r.lastInsertRowid, b.custom);
  res.json({ id: r.lastInsertRowid });
});
router.put('/clients/:id', (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [];
  ['name', 'type', 'vertical_id', 'status'].forEach(f => { if (f in b) { sets.push(`${f}=?`); vals.push(b[f]); } });
  // retainer cost: writable by admin+super (assigning is allowed), even though viewing reports is super-only
  if ('retainer_cost' in b && canSetRetainerCost(req.user.role)) { sets.push('retainer_cost=?'); vals.push(Math.max(0, parseInt(b.retainer_cost) || 0)); }
  if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE clients SET ${sets.join(',')} WHERE id=?`).run(...vals); }
  if (b.custom) setCustomValues('client', +req.params.id, b.custom);
  res.json({ ok: true });
});
router.delete('/clients/:id', (req, res) => {
  if (inUse('jobs', 'client_id', req.params.id))
    return res.status(409).json({ error: 'This client has jobs — reassign or remove them first.' });
  db.prepare('DELETE FROM clients WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- Workflow stages (Strategy / Copy / Art / Artworking + custom) ---------------- */
router.get('/stages', (req, res) => {
  res.json(db.prepare(`SELECT s.*,
    (SELECT COUNT(*) FROM jobs WHERE workflow_stage_id=s.id) AS jobs
    FROM workflow_stages s WHERE s.active=1 ORDER BY s.position, s.id`).all());
});
router.post('/stages', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required.' });
  if (db.prepare('SELECT 1 FROM workflow_stages WHERE name=? AND active=1').get(name))
    return res.status(409).json({ error: 'Already exists.' });
  const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM workflow_stages').get().p;
  const r = db.prepare('INSERT INTO workflow_stages (name,position) VALUES (?,?)').run(name, pos);
  res.json({ id: r.lastInsertRowid, name, position: pos });
});
router.put('/stages/:id', (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [];
  ['name', 'position'].forEach(f => { if (f in b) { sets.push(`${f}=?`); vals.push(b[f]); } });
  if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE workflow_stages SET ${sets.join(',')} WHERE id=?`).run(...vals); }
  res.json({ ok: true });
});
router.delete('/stages/:id', (req, res) => {
  if (inUse('jobs', 'workflow_stage_id', req.params.id))
    return res.status(409).json({ error: 'This stage is used by jobs — reassign them first.' });
  db.prepare('DELETE FROM workflow_stages WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
