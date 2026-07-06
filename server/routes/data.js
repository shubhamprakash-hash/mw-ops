/* ============================================================
   Routes: data — backup / export / restore / reset. SUPER ADMIN ONLY.
     • GET  /data/summary                 counts + available years/months
     • GET  /data/export?scope=backup&format=json         full DB backup (JSON)
     • GET  /data/export?scope=jobs&format=json|csv&period=&date=   report export
     • POST /data/restore   { ...backup }  replace the database from a backup
     • POST /data/reset     { mode }        'zero' (clear operational) | 'wipe' (all but super admin)
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, wipeAll, clearOperational, wipeExceptSuper } = require('../db');
const { jobCost, jobHours, jobTeamNames, customValues, customFieldDefs } = require('../helpers');

/* ---------- helpers ---------- */
const userTables = () => db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);

// FK-safe order for restore (parents first)
const RESTORE_ORDER = ['verticals', 'teams', 'departments', 'users', 'clients', 'cost_rates', 'team_members',
  'workflow_stages', 'jobs', 'job_teams', 'job_assignments', 'timesheet_entries', 'daily_submissions',
  'approvals', 'subtasks', 'attachments', 'brief_versions', 'notifications', 'user_permissions',
  'issues', 'activity_log', 'custom_fields', 'custom_field_values', 'reset_codes'];

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (headers, rows) =>
  [headers.map(csvCell).join(','), ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))].join('\r\n');

function periodBounds(period, date) {
  if (period === 'year' && /^\d{4}$/.test(date || '')) return { from: `${date}-01-01`, to: `${date}-12-31`, label: date };
  if (period === 'month' && /^\d{4}-\d{2}$/.test(date || '')) {
    const [y, m] = date.split('-').map(Number);
    return { from: `${date}-01`, to: `${date}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`, label: date };
  }
  return { from: null, to: null, label: 'all' };
}
const inRange = (d, from, to) => !from || (!!d && d >= from && d <= to);

/* denormalized jobs dataset (what most people mean by "the data") */
function jobsDataset(period, date) {
  const b = periodBounds(period, date);
  const vmap = {}; db.prepare('SELECT id,name FROM verticals').all().forEach(v => vmap[v.id] = v.name);
  const defs = customFieldDefs('job');
  let jobs = db.prepare('SELECT * FROM jobs ORDER BY id').all();
  if (b.from) jobs = jobs.filter(j => inRange(j.job_date, b.from, b.to));
  const rows = jobs.map(j => {
    const cost = jobCost(j.id), hours = jobHours(j.id);
    const row = {
      job_no: j.job_no, ref_no: j.ref_no, year: j.job_year, client: j.client,
      teams: jobTeamNames(j.id).join(' + ') || j.team, vertical: vmap[j.vertical_id] || '',
      task: j.task, workflow_stage: '', stage: j.stage, approval_stage: j.approval_stage,
      brief: j.brief, job_date: j.job_date, due_date: j.due_date, delivery_date: j.delivery_date,
      hours, billing: j.billing, cost, profit: j.billing - cost,
      margin: j.billing ? Math.round((j.billing - cost) / j.billing * 100) : 0,
    };
    const cv = customValues('job', j.id);
    defs.forEach(d => { row['cf_' + d.field_key] = cv[d.field_key] || ''; });
    return row;
  });
  const headers = ['job_no', 'ref_no', 'year', 'client', 'teams', 'vertical', 'task', 'stage', 'approval_stage',
    'brief', 'job_date', 'due_date', 'delivery_date', 'hours', 'billing', 'cost', 'profit', 'margin',
    ...defs.map(d => 'cf_' + d.field_key)];
  return { rows, headers, label: b.label };
}

/* ---------- summary ---------- */
router.get('/summary', (req, res) => {
  const counts = {};
  userTables().forEach(t => { counts[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; });
  const years = db.prepare("SELECT DISTINCT substr(job_date,1,4) y FROM jobs WHERE job_date<>'' ORDER BY y").all().map(r => r.y);
  const months = db.prepare("SELECT DISTINCT substr(job_date,1,7) m FROM jobs WHERE job_date<>'' ORDER BY m DESC").all().map(r => r.m);
  res.json({ counts, years, months, encrypted: !!db.__encrypted });
});

/* ---------- export ---------- */
router.get('/export', (req, res) => {
  const scope = req.query.scope === 'jobs' ? 'jobs' : 'backup';
  const format = req.query.format === 'csv' ? 'csv' : 'json';
  const stamp = new Date().toISOString().slice(0, 10);

  if (scope === 'backup') {
    const tables = {};
    userTables().forEach(t => { tables[t] = db.prepare(`SELECT * FROM ${t}`).all(); });
    const payload = { app: 'monkey-wrench-ops', version: 2, exported_at: new Date().toISOString(), tables };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="mw-ops-backup-${stamp}.json"`);
    return res.send(JSON.stringify(payload, null, 2));
  }

  const { rows, headers, label } = jobsDataset(req.query.period, req.query.date);
  const suffix = label && label !== 'all' ? '-' + label : '';
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="mw-ops-jobs${suffix}-${stamp}.csv"`);
    return res.send(toCsv(headers, rows));
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="mw-ops-jobs${suffix}-${stamp}.json"`);
  res.send(JSON.stringify({ period: label, count: rows.length, jobs: rows }, null, 2));
});

/* ---------- restore ---------- */
router.post('/restore', (req, res) => {
  const body = req.body || {};
  const tables = body.tables;
  if (!tables || typeof tables !== 'object' || !Array.isArray(tables.users))
    return res.status(400).json({ error: 'That doesn\'t look like a Monkey Wrench Ops backup (missing tables/users).' });
  const known = new Set(userTables());
  try {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN');
    wipeAll();
    for (const t of RESTORE_ORDER) {
      const rows = tables[t];
      if (!known.has(t) || !Array.isArray(rows) || !rows.length) continue;
      const cols = Object.keys(rows[0]);
      const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const row of rows) stmt.run(...cols.map(c => row[c]));
    }
    db.exec('COMMIT; PRAGMA foreign_keys=ON');
  } catch (e) {
    try { db.exec('ROLLBACK; PRAGMA foreign_keys=ON'); } catch {}
    return res.status(400).json({ error: 'Restore failed and was rolled back: ' + e.message });
  }
  const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  res.json({ ok: true, users });
});

/* ---------- reset ----------
   mode 'zero' → clear all operational data; keep people, clients & setup (no sample data)
   mode 'wipe' → remove everything except the Super Admin logins                */
router.post('/reset', (req, res) => {
  const mode = (req.body && req.body.mode) || '';
  try {
    if (mode === 'zero') clearOperational();
    else if (mode === 'wipe') wipeExceptSuper();
    else return res.status(400).json({ error: 'Unknown reset mode.' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ ok: true, mode });
});

module.exports = router;
