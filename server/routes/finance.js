/* ============================================================
   Routes: finance — dashboard, P&L, bandwidth, year-on-year
   SUPER ADMIN ONLY (mounted under requireSuper).

   Reporting periods: month / year / since-inception.
   Convention: a job is recognised in the period of its JOB DATE
   (job-cohort accounting), and its cost is the full dated cost of
   the hours logged against it. The Bandwidth report instead works
   off timesheet work-dates, since it measures hours actually logged.
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { jobCost, jobHours } = require('../helpers');

const STAGES = ['Pipeline', 'Pending', 'Studio', 'Review', 'Done', 'Approved'];

/* ---------- period helpers ---------- */
const pad2 = n => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' }) + ' ' + y;
}
function defaultMonth() {
  const r = db.prepare('SELECT MAX(work_date) m FROM timesheet_entries').get();
  return (r && r.m) ? r.m.slice(0, 7) : new Date().toISOString().slice(0, 7);
}
function dataBounds() {
  const r = db.prepare(`SELECT MIN(d) a, MAX(d) b FROM (
    SELECT job_date d FROM jobs WHERE job_date<>'' UNION ALL
    SELECT work_date d FROM timesheet_entries)`).get();
  return { min: r.a, max: r.b };
}
function periodRange(period, date) {
  if (period === 'month') {
    const ym = (date && /^\d{4}-\d{2}$/.test(date)) ? date : defaultMonth();
    const [y, m] = ym.split('-').map(Number);
    return { from: `${ym}-01`, to: `${ym}-${pad2(lastDay(y, m))}`, label: monthLabel(ym), kind: 'month', key: ym };
  }
  if (period === 'year') {
    const y = (date && /^\d{4}$/.test(date)) ? date : String(new Date().getFullYear());
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: y, kind: 'year', key: y };
  }
  return { from: null, to: null, label: 'Since inception', kind: 'all', key: 'all' };
}
const inRange = (d, from, to) => !from || (!!d && d >= from && d <= to);
function workingDays(from, to) {
  if (!from || !to) return 0;
  let d = new Date(from + 'T00:00:00Z'); const end = new Date(to + 'T00:00:00Z'); let n = 0;
  while (d <= end) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; d.setUTCDate(d.getUTCDate() + 1); }
  return n;
}
const clientTypeMap = () => {
  const m = {}; db.prepare('SELECT id,type FROM clients').all().forEach(c => m[c.id] = c.type); return m;
};
/* jobs filtered by vertical + period (job-cohort) + client type */
function filterJobs({ vId, period, date, type }) {
  const pr = periodRange(period, date);
  const ctype = clientTypeMap();
  let jobs = db.prepare('SELECT * FROM jobs').all();
  if (vId) jobs = jobs.filter(j => j.vertical_id === vId);
  if (pr.from) jobs = jobs.filter(j => inRange(j.job_date, pr.from, pr.to));
  if (type === 'project' || type === 'retainership') jobs = jobs.filter(j => (ctype[j.client_id] || 'project') === type);
  return { jobs, pr, ctype };
}
const verticalsList = () => db.prepare('SELECT id,name FROM verticals ORDER BY name').all();

/* ---------- dashboard ---------- */
router.get('/dashboard', (req, res) => {
  const vId = req.query.vertical_id ? +req.query.vertical_id : null;
  const { jobs, pr } = filterJobs({ vId, period: req.query.period, date: req.query.date, type: req.query.type });
  let billing = 0, cost = 0, active = 0;
  const byClient = {};
  jobs.forEach(j => {
    const c = jobCost(j.id); billing += j.billing; cost += c;
    if (j.stage !== 'Approved' && j.stage !== 'Done') active++;
    const cl = j.client || '—';
    byClient[cl] = byClient[cl] || { client: cl, billing: 0, cost: 0 };
    byClient[cl].billing += j.billing; byClient[cl].cost += c;
  });
  const jobIds = jobs.map(j => j.id);
  const hours = jobIds.length
    ? db.prepare(`SELECT COALESCE(SUM(hours),0) h FROM timesheet_entries WHERE job_id IN (${jobIds.map(() => '?').join(',')})`).get(...jobIds).h
    : 0;
  const clients = Object.values(byClient).map(c => ({ ...c, profit: c.billing - c.cost }));
  const stageCount = {};
  STAGES.forEach(s => stageCount[s] = jobs.filter(j => j.stage === s).length);
  res.json({
    billing, cost, profit: billing - cost, margin: billing ? (billing - cost) / billing * 100 : 0,
    hours, jobs: jobs.length, active,
    clients: clients.sort((a, b) => b.billing - a.billing),
    stageCount, verticals: verticalsList(), vertical_id: vId,
    period: pr.kind, period_label: pr.label, period_key: pr.key,
  });
});

/* ---------- P&L (by client / job / vertical, period + type aware) ---------- */
router.get('/pnl', (req, res) => {
  const vId = req.query.vertical_id ? +req.query.vertical_id : null;
  const type = req.query.type;
  const mode = req.query.mode === 'job' ? 'job' : req.query.mode === 'vertical' ? 'vertical' : 'client';
  // 'vertical' mode ignores the vertical filter (it groups by vertical) but still honours period + type
  const { jobs, pr, ctype } = filterJobs({ vId: mode === 'vertical' ? null : vId, period: req.query.period, date: req.query.date, type });
  const meta = { mode, period: pr.kind, period_label: pr.label, period_key: pr.key, type: type || 'all' };

  if (mode === 'job') {
    const rows = jobs.slice().reverse().map(j => {
      const cost = jobCost(j.id);
      return { name: j.job_no, sub: j.brief, client: j.client, billing: j.billing,
        cost, hours: jobHours(j.id), profit: j.billing - cost,
        margin: j.billing ? (j.billing - cost) / j.billing * 100 : 0 };
    });
    return res.json({ ...meta, rows });
  }
  const keyFn = mode === 'vertical'
    ? j => { const v = db.prepare('SELECT name FROM verticals WHERE id=?').get(j.vertical_id); return v ? v.name : '—'; }
    : j => j.client || '—';
  const m = {};
  jobs.forEach(j => {
    const k = keyFn(j);
    m[k] = m[k] || { name: k, jobs: 0, billing: 0, cost: 0, hours: 0 };
    m[k].jobs++; m[k].billing += j.billing; m[k].cost += jobCost(j.id); m[k].hours += jobHours(j.id);
  });
  const rows = Object.values(m).map(r => ({ ...r, profit: r.billing - r.cost, margin: r.billing ? (r.billing - r.cost) / r.billing * 100 : 0 }));
  res.json({ ...meta, rows });
});

/* ---------- Team bandwidth (available vs logged hours, utilisation) ---------- */
router.get('/bandwidth', (req, res) => {
  const vId = req.query.vertical_id ? +req.query.vertical_id : null;
  const hpd = req.query.hours_per_day ? Math.max(1, +req.query.hours_per_day) : 8;
  const pr = periodRange(req.query.period || 'month', req.query.date);
  let from = pr.from, to = pr.to, label = pr.label;
  if (pr.kind === 'all') { const b = dataBounds(); from = b.min; to = b.max; label = (b.min && b.max) ? `${b.min} → ${b.max}` : 'All time'; }
  const wd = workingDays(from, to);
  const available = wd * hpd;
  const people = db.prepare("SELECT id,name,job_role FROM users WHERE active=1 AND role IN ('member','team_lead') ORDER BY name").all();
  const rows = people.map(p => {
    let q = 'SELECT COALESCE(SUM(t.hours),0) h FROM timesheet_entries t JOIN jobs j ON j.id=t.job_id WHERE t.user_id=?';
    const args = [p.id];
    if (from) { q += ' AND date(t.work_date)>=date(?) AND date(t.work_date)<=date(?)'; args.push(from, to); }
    if (vId) { q += ' AND j.vertical_id=?'; args.push(vId); }
    const logged = db.prepare(q).get(...args).h;
    const team = db.prepare('SELECT t.name FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=? LIMIT 1').get(p.id);
    return { id: p.id, name: p.name, craft: p.job_role, team: team ? team.name : '—',
      available, logged, utilisation: available ? logged / available * 100 : 0 };
  });
  const totLogged = rows.reduce((s, r) => s + r.logged, 0);
  const totAvail = rows.reduce((s, r) => s + r.available, 0);
  res.json({
    period: pr.kind, period_key: pr.key, label, from, to, working_days: wd, hours_per_day: hpd,
    rows: rows.sort((a, b) => b.utilisation - a.utilisation),
    totals: { available: totAvail, logged: totLogged, utilisation: totAvail ? totLogged / totAvail * 100 : 0 },
    verticals: verticalsList(), vertical_id: vId,
  });
});

/* ---------- Year-on-year ---------- */
router.get('/yoy', (req, res) => {
  const vId = req.query.vertical_id ? +req.query.vertical_id : null;
  const type = req.query.type;
  const ctype = clientTypeMap();
  let jobs = db.prepare('SELECT * FROM jobs').all();
  if (vId) jobs = jobs.filter(j => j.vertical_id === vId);
  if (type === 'project' || type === 'retainership') jobs = jobs.filter(j => (ctype[j.client_id] || 'project') === type);
  const years = {};
  jobs.forEach(j => {
    const y = (j.job_date || '').slice(0, 4);
    if (!y) return;
    const c = jobCost(j.id), h = jobHours(j.id), t = ctype[j.client_id] || 'project';
    years[y] = years[y] || { year: y, jobs: 0, billing: 0, cost: 0, hours: 0, project: 0, retainership: 0 };
    years[y].jobs++; years[y].billing += j.billing; years[y].cost += c; years[y].hours += h;
    years[y][t] = (years[y][t] || 0) + j.billing;
  });
  const rows = Object.values(years).sort((a, b) => a.year.localeCompare(b.year))
    .map(r => ({ ...r, profit: r.billing - r.cost, margin: r.billing ? (r.billing - r.cost) / r.billing * 100 : 0 }));
  res.json({ rows, verticals: verticalsList(), vertical_id: vId, type: type || 'all' });
});

module.exports = router;
