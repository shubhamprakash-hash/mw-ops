/* ============================================================
   Monkey Wrench Ops 2.0 — database
   Foundation schema: verticals, teams, departments, clients,
   reporting hierarchy, dated cost history, plus the v1 job /
   timesheet / approval tables (carried over).
   ============================================================ */
const path = require('path');
const fs = require('fs');
const Database = require('./sqlite');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'mw-ops.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ---------- roles & access ----------
   2.0 change: FINANCIALS ARE SUPER-ADMIN-ONLY.
   - isBackend  : reaches the backend (masters, user management, operational admin) = admin + super_admin
   - canSeeMoney: billing / cost / P&L / rates = super_admin ONLY
   - canSetRetainerCost: may *enter* a retainership's cost (but not view financial reports) = admin + super_admin */
const ROLES = ['super_admin', 'admin', 'team_lead', 'member'];
const ROLE_RANK = { member: 1, team_lead: 2, admin: 3, super_admin: 4 };
const isBackend = role => role === 'admin' || role === 'super_admin';
const isSuper = role => role === 'super_admin';
const canSetRetainerCost = role => role === 'admin' || role === 'super_admin';

/* ---------- granular capabilities (Phase 4) ----------
   Capabilities layer on top of roles. A role grants a default set; a Super Admin
   can additionally GRANT a capability to a specific user, or REVOKE a default.
   Role still governs job-board scope, approvals, timesheets and job creation. */
const CAPABILITIES = ['view_finance', 'manage_masters', 'manage_users', 'view_activity'];
const ROLE_CAPS = {
  super_admin: ['view_finance', 'manage_masters', 'manage_users', 'view_activity'],
  admin: ['manage_masters', 'manage_users', 'view_activity'],
  team_lead: [],
  member: [],
};
function capabilitiesOf(user) {
  if (!user) return new Set();
  const set = new Set(ROLE_CAPS[user.role] || []);
  try {
    db.prepare('SELECT capability, granted FROM user_permissions WHERE user_id = ?').all(user.id)
      .forEach(r => { if (r.granted) set.add(r.capability); else set.delete(r.capability); });
  } catch { /* table may not exist on a very old DB before migration */ }
  return set;
}
const userHasCap = (user, cap) => capabilitiesOf(user).has(cap);
/* canSeeMoney is polymorphic: pass a user object (capability-aware) or a role string (legacy). */
const canSeeMoney = viewer =>
  (viewer && typeof viewer === 'object') ? userHasCap(viewer, 'view_finance') : viewer === 'super_admin';

const STAGES = ['Pipeline', 'Pending', 'Studio', 'Review', 'Done', 'Approved'];
const APPROVAL = ['none', 'submitted', 'lead_approved', 'admin_approved', 'approved', 'rejected'];
const LEVEL_FOR_ROLE = { team_lead: 'submitted', admin: 'lead_approved', super_admin: 'admin_approved' };
const NEXT_APPROVAL = { submitted: 'lead_approved', lead_approved: 'admin_approved', admin_approved: 'approved' };

const OFFICE_DOMAIN = process.env.OFFICE_DOMAIN || 'monkeywrench.in';

/* ---------- schema ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS verticals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vertical_id INTEGER REFERENCES verticals(id),
  sub_vertical TEXT DEFAULT '',
  lead_id INTEGER REFERENCES users(id),
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  vertical_id INTEGER REFERENCES verticals(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  job_role TEXT,                       -- craft: AM / Copy / Art / Studio
  department_id INTEGER REFERENCES departments(id),
  reports_to INTEGER REFERENCES users(id),
  password_hash TEXT NOT NULL,
  must_change_pw INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- many-to-many team membership (a person can sit on >1 team; moving = changing rows)
CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(team_id, user_id)
);

-- dated employee cost-per-hour history (SUPER-ADMIN ONLY).
-- A job's cost uses the rate effective on the date each hour was logged,
-- so a later pay revision never rewrites historical financials.
CREATE TABLE IF NOT EXISTS cost_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cost_per_hour INTEGER NOT NULL,
  effective_from TEXT NOT NULL,        -- YYYY-MM-DD
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'project',         -- project | retainership
  seq_no INTEGER,                      -- 4-digit running client number (used in job numbering)
  vertical_id INTEGER REFERENCES verticals(id),
  status TEXT DEFAULT 'converted',     -- prospective | converted
  retainer_cost INTEGER DEFAULT 0,     -- money (super-admin view); set by admin+super
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_no TEXT NOT NULL,
  ref_no TEXT DEFAULT '',
  job_year INTEGER,                    -- structured numbering: YEAR/SERIAL/SEQ/Rround
  serial INTEGER,                      -- 4-digit running number (per family)
  job_seq INTEGER DEFAULT 1,           -- job index within the family
  round INTEGER DEFAULT 1,             -- increments on re-assignment / rework
  client TEXT DEFAULT '',              -- denormalised client name (kept for display)
  client_id INTEGER REFERENCES clients(id),
  vertical_id INTEGER REFERENCES verticals(id),
  team TEXT DEFAULT '',
  stage TEXT DEFAULT 'Pipeline',
  workflow_stage_id INTEGER REFERENCES workflow_stages(id),
  task TEXT DEFAULT '',
  brief TEXT DEFAULT '',
  billing INTEGER DEFAULT 0,           -- money; super-admin only
  job_date TEXT DEFAULT '',            -- auto-set on creation (YYYY-MM-DD)
  due_date TEXT DEFAULT '',
  delivery_date TEXT DEFAULT '',       -- planned delivery to client
  approval_stage TEXT DEFAULT 'none',
  reject_note TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_on_job TEXT DEFAULT '',
  assigned_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(job_id, user_id)
);

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  hours REAL NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  submitted_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, work_date)
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  approver_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- configurable production workflow stages (Strategy / Copy / Art / Artworking + custom)
CREATE TABLE IF NOT EXISTS workflow_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- sub-tasks under a job (Task -> Subtask)
CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  assignee_id INTEGER REFERENCES users(id),
  position INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- file attachments (stored as base64 text so they travel with the SQLite file
-- and work identically on both DB drivers)
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT DEFAULT 'application/octet-stream',
  size INTEGER DEFAULT 0,
  content_b64 TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- brief version history (a snapshot is written each time a job's brief changes)
CREATE TABLE IF NOT EXISTS brief_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  brief TEXT DEFAULT '',
  edited_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- in-app notifications (the bell)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'info',
  message TEXT NOT NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- immutable audit trail / activity log (append-only; never updated or deleted)
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id),
  actor_name TEXT DEFAULT '',          -- denormalized snapshot, stays correct even if the user is renamed/removed
  entity_type TEXT NOT NULL,           -- job | subtask | attachment | approval | issue | assignment | round
  entity_id INTEGER,
  job_id INTEGER,                      -- for per-job filtering (nullable)
  action TEXT NOT NULL,                -- created | updated | deleted | assigned | unassigned | stage | submitted | approved | rejected | round | raised | resolved
  field TEXT DEFAULT '',
  old_value TEXT DEFAULT '',
  new_value TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- issues / blockers raised against a job
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  severity TEXT DEFAULT 'blocker',     -- blocker | issue | note
  status TEXT DEFAULT 'open',          -- open | resolved
  raised_by INTEGER REFERENCES users(id),
  assigned_to INTEGER REFERENCES users(id),
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- multiple teams per job (many-to-many); jobs.team is kept as the primary team for display
CREATE TABLE IF NOT EXISTS job_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE(job_id, team_id)
);

-- granular per-user capability grants/revokes layered on top of role defaults
CREATE TABLE IF NOT EXISTS user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,            -- view_finance | manage_masters | manage_users | view_activity
  granted INTEGER DEFAULT 1,           -- 1 = grant, 0 = explicit revoke of a role default
  granted_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_act_job ON activity_log(job_id);
CREATE INDEX IF NOT EXISTS idx_act_actor ON activity_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_issue_job ON issues(job_id);
CREATE INDEX IF NOT EXISTS idx_jobteam_job ON job_teams(job_id);
CREATE INDEX IF NOT EXISTS idx_jobteam_team ON job_teams(team_id);

CREATE INDEX IF NOT EXISTS idx_ts_user_date ON timesheet_entries(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_assign_user ON job_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assign_job ON job_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_tm_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_rate_user ON cost_rates(user_id, effective_from);
`);

/* ---------- lightweight migrations (for DBs created before Phase 2) ---------- */
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn('clients', 'seq_no', 'INTEGER');
ensureColumn('jobs', 'job_date', "TEXT DEFAULT ''");
ensureColumn('jobs', 'delivery_date', "TEXT DEFAULT ''");
ensureColumn('jobs', 'workflow_stage_id', 'INTEGER');
// Backfill 4-digit client numbers for any clients missing one.
const missingSeq = db.prepare('SELECT id FROM clients WHERE seq_no IS NULL ORDER BY id').all();
if (missingSeq.length) {
  let next = (db.prepare('SELECT COALESCE(MAX(seq_no),0) m FROM clients').get().m) + 1;
  const setSeq = db.prepare('UPDATE clients SET seq_no=? WHERE id=?');
  missingSeq.forEach(c => setSeq.run(next++, c.id));
}
// Backfill job_teams from the legacy single-team field for any job not yet mapped.
(function backfillJobTeams() {
  const orphans = db.prepare(`SELECT j.id, j.team FROM jobs j
    WHERE NOT EXISTS (SELECT 1 FROM job_teams jt WHERE jt.job_id = j.id)`).all();
  if (!orphans.length) return;
  const teamByName = {};
  db.prepare('SELECT id,name FROM teams').all().forEach(t => teamByName[t.name] = t.id);
  const ins = db.prepare('INSERT OR IGNORE INTO job_teams (job_id,team_id) VALUES (?,?)');
  orphans.forEach(j => { const tid = teamByName[j.team]; if (tid) ins.run(j.id, tid); });
})();


/* ---------- seed ---------- */
function alreadySeeded() {
  return db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;
}

function seed() {
  const hash = pw => bcrypt.hashSync(pw, 10);
  const DEFAULT_PW = process.env.SEED_PASSWORD || 'changeme123';

  // production workflow stages (extensible later via Masters)
  const insWS = db.prepare('INSERT INTO workflow_stages (name,position) VALUES (?,?)');
  ['Strategy', 'Copy', 'Art', 'Artworking'].forEach((n, i) => insWS.run(n, i));

  // verticals
  const insV = db.prepare('INSERT INTO verticals (name) VALUES (?)');
  const digital = insV.run('Digital').lastInsertRowid;
  const mainline = insV.run('Mainline').lastInsertRowid;

  // teams (lead_id set after users exist)
  const insT = db.prepare('INSERT INTO teams (name,vertical_id,sub_vertical) VALUES (?,?,?)');
  const hornet = insT.run('Hornet', mainline, 'Creative').lastInsertRowid;
  const raptor = insT.run('Raptor', mainline, 'Creative').lastInsertRowid;
  const studio = insT.run('Studio', digital, 'Production').lastInsertRowid;

  // departments
  const insD = db.prepare('INSERT INTO departments (name,vertical_id) VALUES (?,?)');
  const depAM   = insD.run('Account Management', mainline).lastInsertRowid;
  const depCopy = insD.run('Copywriting', mainline).lastInsertRowid;
  const depArt  = insD.run('Art', mainline).lastInsertRowid;
  const depStudio = insD.run('Studio', digital).lastInsertRowid;
  const deptFor = craft => ({ AM: depAM, Copy: depCopy, Art: depArt, Studio: depStudio }[craft] || null);

  // users (insert in hierarchy order so reports_to resolves)
  const insUser = db.prepare(`INSERT INTO users (email,name,role,job_role,department_id,reports_to,password_hash,must_change_pw)
    VALUES (@email,@name,@role,@job_role,@department_id,@reports_to,@password_hash,@must_change_pw)`);
  const mk = (email, name, role, craft, reports_to = null, must = 1) =>
    insUser.run({ email: `${email}@${OFFICE_DOMAIN}`, name, role, job_role: craft,
      department_id: deptFor(craft), reports_to, password_hash: hash(DEFAULT_PW), must_change_pw: must }).lastInsertRowid;

  // the two named Super Admins (financial confidentiality holders)
  const sanjay = mk('sanjay', 'Sanjay Joshi', 'super_admin', null, null, 1);
  const pawas  = mk('pawas', 'Pawas Shah', 'super_admin', null, null, 1);
  // admin (operational, NO financial visibility)
  const ops    = mk('ops', 'Ops Admin', 'admin', null, sanjay, 1);

  // team leads
  const shivani = mk('shivani', 'Shivani', 'team_lead', 'AM', ops);
  const adrija  = mk('adrija', 'Adrija', 'team_lead', 'AM', ops);
  const saddam  = mk('saddam', 'Saddam', 'team_lead', 'Studio', ops);

  // members → report to their lead
  const M = {};
  const addM = (key, email, name, craft, lead) => { M[key] = mk(email, name, 'member', craft, lead); };
  addM('Kusumanjan','kusumanjan','Kusumanjan','AM',shivani);
  addM('Avishek','avishek','Avishek','AM',shivani);
  addM('Anwesa','anwesa','Anwesa','Copy',shivani);
  addM('Shreyasi','shreyasi','Shreyasi','Art',shivani);
  addM('Prakash','prakash','Prakash','Art',shivani);
  addM('Srinjani','srinjani','Srinjani','Copy',adrija);
  addM('Pronay','pronay','Pronay','Art',adrija);
  addM('Aritra','aritra','Aritra','Art',adrija);
  addM('Tiyash','tiyash','Tiyash','AM',adrija);
  addM('Mrinmoyee','mrinmoyee','Mrinmoyee','AM',adrija);
  addM('Gaurab','gaurab','Gaurab','Studio',saddam);
  addM('Rahul','rahul','Rahul','Studio',saddam);
  addM('Sanu','sanu','Sanu','Studio',saddam);
  M.Shivani = shivani; M.Adrija = adrija; M.Saddam = saddam;

  // set team leads
  db.prepare('UPDATE teams SET lead_id=? WHERE id=?').run(shivani, hornet);
  db.prepare('UPDATE teams SET lead_id=? WHERE id=?').run(adrija, raptor);
  db.prepare('UPDATE teams SET lead_id=? WHERE id=?').run(saddam, studio);

  // team membership
  const insTM = db.prepare('INSERT OR IGNORE INTO team_members (team_id,user_id) VALUES (?,?)');
  const team = { Hornet: hornet, Raptor: raptor, Studio: studio };
  const join = (teamName, ...keys) => keys.forEach(k => insTM.run(team[teamName], M[k]));
  join('Hornet','Shivani','Kusumanjan','Avishek','Anwesa','Shreyasi','Prakash');
  join('Raptor','Adrija','Srinjani','Pronay','Aritra','Tiyash','Mrinmoyee');
  join('Studio','Saddam','Gaurab','Rahul','Sanu');

  // dated cost-per-hour history (super-admin only).
  // Three tiers demonstrate historical integrity: a 2025 baseline, a 2026 base
  // (most people's "current" rate), and a June-2026 raise for two people — so a
  // job costed in May-2026 keeps the OLD rate even after the June rise, and 2025
  // jobs cost at the 2025 rate.
  const insRate = db.prepare('INSERT INTO cost_rates (user_id,cost_per_hour,effective_from,created_by) VALUES (?,?,?,?)');
  const baseRate = { Kusumanjan:900, Avishek:800, Anwesa:700, Shreyasi:700, Prakash:800,
    Srinjani:650, Pronay:700, Aritra:800, Tiyash:800, Mrinmoyee:750,
    Gaurab:550, Rahul:550, Sanu:500, Shivani:850, Adrija:850, Saddam:550 };
  // 2025 tier ≈ 12% lower than the 2026 base (rounded to the nearest 50)
  Object.entries(baseRate).forEach(([k, r]) => insRate.run(M[k], Math.round(r * 0.88 / 50) * 50, '2025-01-01', sanjay));
  Object.entries(baseRate).forEach(([k, r]) => insRate.run(M[k], r, '2026-01-01', sanjay));
  // raises effective June (historical integrity demo)
  insRate.run(M.Aritra, 950, '2026-06-01', sanjay);
  insRate.run(M.Gaurab, 650, '2026-06-01', sanjay);

  // clients master (typed + vertical + status). One prospective to demo.
  const insC = db.prepare('INSERT INTO clients (name,type,seq_no,vertical_id,status,retainer_cost,created_by) VALUES (?,?,?,?,?,?,?)');
  const C = {}; const Cseq = {}; let clientSeq = 1;
  const addC = (name, type, vId, status = 'converted', retainer = 0) => {
    const seq = clientSeq++;
    C[name] = insC.run(name, type, seq, vId, status, retainer, ops).lastInsertRowid;
    Cseq[name] = seq;
  };
  addC('Nipha','project',mainline);
  addC('Polar','retainership',mainline,'converted',150000);
  addC('Supra','retainership',mainline,'converted',200000);
  addC('Sawansukha','project',mainline);
  addC('OneHorn','project',digital);
  addC('Doreme','retainership',digital,'converted',120000);
  addC('Total','project',digital);
  addC('MW','retainership',digital,'converted',0);
  addC('Red Pan — Bold Asian','project',mainline);
  addC('Lighthouse Realty','project',mainline,'prospective'); // not yet converted

  // jobs (from the 11-May sheet) linked to client master + vertical.
  // Job numbers use the 2.0 structured scheme: YEAR / ClientNo(4) / JobNo(2) / R{round}.
  const insJob = db.prepare(`INSERT INTO jobs (job_no,ref_no,job_year,serial,job_seq,round,client,client_id,vertical_id,team,stage,task,brief,billing,job_date,due_date,delivery_date,approval_stage,created_by)
    VALUES (@job_no,@ref_no,@job_year,@serial,@job_seq,@round,@client,@client_id,@vertical_id,@team,@stage,@task,@brief,@billing,@job_date,@due_date,@delivery_date,@approval_stage,@created_by)`);
  const insAssign = db.prepare('INSERT OR IGNORE INTO job_assignments (job_id,user_id,role_on_job,assigned_by) VALUES (?,?,?,?)');
  const vertOfTeam = t => (t === 'Studio' ? digital : mainline);
  const pad = (n, w) => String(n).padStart(w, '0');
  const YEAR = 2026;
  const jobSeqByClient = {};            // running job index within each client family
  const legacyId = {};                  // legacy sheet number -> first job id (for timesheet seeding)
  const J = (o, assignees) => {
    const legacyNo = o.job_no || '';
    const seq = Cseq[o.client] || 0;
    const jno = (jobSeqByClient[o.client] = (jobSeqByClient[o.client] || 0) + 1);
    const row = Object.assign({ ref_no: '', team: '', stage: 'Pipeline', task: '', brief: '',
      billing: 0, job_date: '2026-05-01', due_date: '', delivery_date: '', approval_stage: 'none', created_by: ops }, o);
    const yr = (row.job_date && /^\d{4}/.test(row.job_date)) ? row.job_date.slice(0, 4) : String(YEAR);
    row.job_year = +yr; row.serial = seq; row.job_seq = jno; row.round = 1;
    row.job_no = `${yr}/${pad(seq, 4)}/${pad(jno, 2)}/R1`;
    if (!row.delivery_date) row.delivery_date = row.due_date;
    row.client_id = C[row.client] || null;
    row.vertical_id = vertOfTeam(row.team);
    const id = insJob.run(row).lastInsertRowid;
    if (legacyNo && !(legacyNo in legacyId)) legacyId[legacyNo] = id;
    (assignees || []).forEach(([name, craft]) => { if (M[name]) insAssign.run(id, M[name], craft, shivani); });
    return id;
  };

  J({job_no:'4324_01',client:'Nipha',team:'Hornet',stage:'Pending',task:'Design',brief:'Visual Mark — Candle Route + New Route',billing:45000,due_date:'2026-05-06'},
    [['Kusumanjan','AM'],['Anwesa','Copy'],['Srinjani','Copy'],['Pronay','Art'],['Prakash','Art']]);
  J({job_no:'4302_12',client:'Polar',team:'Hornet',stage:'Pending',task:'Design',brief:'Platinum Group — Back drop',billing:20000,due_date:'2026-05-11'},
    [['Avishek','AM'],['Shreyasi','Art']]);
  J({job_no:'4301_22',client:'Supra',team:'Hornet',stage:'Pending',task:'Ideation + Design',brief:'Insta Ball Launch A4 Poster',billing:24000,due_date:'2026-05-12'},
    [['Shivani','AM'],['Adrija','AM'],['Shreyasi','Art'],['Aritra','Art']]);
  J({job_no:'4301_08',client:'Supra',team:'Hornet',stage:'Pending',task:'Design',brief:'Stelix 1U Blister Pack',billing:35000,due_date:'2026-05-11'},
    [['Shivani','AM'],['Aritra','Art']]);
  J({job_no:'4318_07',client:'Sawansukha',team:'Hornet',stage:'Pending',task:'Design',brief:'Sunday Surprise — Press ad',billing:18000,due_date:'2026-05-12'},
    [['Adrija','AM'],['Avishek','AM'],['Aritra','Art']]);
  J({job_no:'4302_11',client:'Polar',team:'Raptor',stage:'Pending',task:'Ideation + Design',brief:"Father's Day Wish Post",billing:9000,due_date:'2026-05-11'},
    [['Avishek','AM'],['Anwesa','Copy'],['Srinjani','Copy'],['Shreyasi','Art'],['Aritra','Art']]);
  J({job_no:'4318_04',client:'Sawansukha',team:'Raptor',stage:'Pending',task:'Design',brief:'Brand Identity',billing:160000},
    [['Adrija','AM'],['Avishek','AM'],['Anwesa','Copy'],['Pronay','Art'],['Prakash','Art']]);
  J({job_no:'4317_01',ref_no:'4237_07',client:'OneHorn',team:'Studio',stage:'Done',task:'AW',brief:'Launch Campaign — Retail Collateral Instore 1x1, 1x2 (Odia, Telugu, Marathi)',billing:120000,due_date:'2026-05-11',approval_stage:'admin_approved'},
    [['Adrija','AM'],['Saddam','Studio']]);
  J({job_no:'4317_01',ref_no:'4237_07',client:'OneHorn',team:'Studio',stage:'Done',task:'Modification',brief:'Launch Campaign — Retail Collateral Instore 2x1, 1x3, 3x1 (Hin, Ben, Odia, Tel, Mar)',billing:90000,due_date:'2026-05-11',approval_stage:'lead_approved'},
    [['Adrija','AM'],['Saddam','Studio']]);
  J({job_no:'4304_07',client:'Doreme',team:'Studio',stage:'Done',task:'Modification',brief:'Investor Presentation',billing:35000,due_date:'2026-05-11',approval_stage:'submitted'},
    [['Shivani','AM'],['Gaurab','Studio']]);
  J({job_no:'4321_02',ref_no:'4251_03',client:'Total',team:'Studio',stage:'Done',task:'Modification',brief:'Egg Packaging — Sleeve — Classic',billing:42000,due_date:'2026-05-11',approval_stage:'submitted'},
    [['Adrija','AM'],['Shivani','AM'],['Rahul','Studio']]);
  J({job_no:'4207_60',client:'Doreme',team:'Studio',stage:'Done',task:'Image Correction',brief:'Website Images',billing:30000,approval_stage:'approved'},
    [['Tiyash','AM'],['Sanu','Studio'],['Gaurab','Studio']]);
  J({job_no:'4301_10',client:'Supra',team:'Studio',stage:'Done',task:'Modification',brief:'Domestic Catalogue',billing:60000,due_date:'2026-05-11',approval_stage:'lead_approved'},
    [['Shivani','AM'],['Rahul','Studio']]);
  J({job_no:'4318_07',client:'Sawansukha',team:'Studio',stage:'Done',task:'Modification',brief:'Sunday Surprise — Press Ad',billing:18000,due_date:'2026-05-11',approval_stage:'submitted'},
    [['Adrija','AM'],['Avishek','AM'],['Rahul','Studio']]);
  J({job_no:'4302_12',client:'Polar',team:'Studio',stage:'Done',task:'AW',brief:'Platinum Group Backdrop',billing:20000,due_date:'2026-05-11',approval_stage:'admin_approved'},
    [['Avishek','AM'],['Gaurab','Studio']]);
  J({job_no:'4318_06',client:'Sawansukha',team:'Raptor',stage:'Review',task:'Review',brief:'Wedding Campaign — Golf — Gold & Diamond',billing:75000},
    [['Adrija','AM'],['Avishek','AM'],['Aritra','Art']]);
  J({job_no:'4301_20',client:'Supra',team:'Hornet',stage:'Review',task:'Ideation + Design',brief:'Capoo Launch A4 Poster',billing:24000,due_date:'2026-05-08'},
    [['Shivani','AM'],['Adrija','AM'],['Anwesa','Copy'],['Aritra','Art'],['Shreyasi','Art']]);
  J({job_no:'4213_03',client:'MW',team:'Studio',stage:'Pipeline',task:'',brief:'HR Kit Addition',billing:25000},[['Mrinmoyee','AM']]);
  J({job_no:'4301_10',client:'Supra',team:'Hornet',stage:'Pipeline',task:'Modification',brief:'Domestic Catalogue',billing:60000},[['Shivani','AM']]);
  J({job_no:'4330_01',client:'Red Pan — Bold Asian',team:'Hornet',stage:'Pipeline',task:'Design',brief:'Brand Identity',billing:160000},[['Adrija','AM'],['Anwesa','Copy'],['Prakash','Art']]);
  J({job_no:'4301_21',client:'Supra',team:'Hornet',stage:'Pipeline',task:'Design',brief:'Hotline',billing:20000},[['Shivani','AM'],['Adrija','AM'],['Shreyasi','Art']]);

  // ---- prior-year (2025) sample jobs, for year-on-year & period reporting ----
  // All closed/Approved; dated across 2025 so the YoY view has a previous year to compare.
  const p25 = [
    J({job_no:'PY25_01',client:'Polar',team:'Hornet',stage:'Approved',task:'Design',brief:'2025 Retainer — Q1 Social Pack',billing:120000,job_date:'2025-02-10',due_date:'2025-02-28',approval_stage:'approved'},[['Avishek','AM'],['Shreyasi','Art']]),
    J({job_no:'PY25_02',client:'Supra',team:'Hornet',stage:'Approved',task:'Ideation + Design',brief:'2025 Diwali Campaign',billing:185000,job_date:'2025-09-05',due_date:'2025-10-01',approval_stage:'approved'},[['Shivani','AM'],['Aritra','Art'],['Anwesa','Copy']]),
    J({job_no:'PY25_03',client:'Doreme',team:'Studio',stage:'Approved',task:'AW',brief:'2025 Annual Report — Artworking',billing:90000,job_date:'2025-06-18',due_date:'2025-07-10',approval_stage:'approved'},[['Gaurab','Studio'],['Rahul','Studio']]),
    J({job_no:'PY25_04',client:'OneHorn',team:'Studio',stage:'Approved',task:'Modification',brief:'2025 Retail Collateral Refresh',billing:75000,job_date:'2025-11-22',due_date:'2025-12-15',approval_stage:'approved'},[['Sanu','Studio'],['Adrija','AM']]),
    J({job_no:'PY25_05',client:'Sawansukha',team:'Raptor',stage:'Approved',task:'Design',brief:'2025 Wedding Collection Launch',billing:140000,job_date:'2025-03-30',due_date:'2025-04-20',approval_stage:'approved'},[['Adrija','AM'],['Pronay','Art'],['Srinjani','Copy']]),
  ];

  // sample timesheets + daily submissions
  const insTs = db.prepare("INSERT INTO timesheet_entries (user_id,job_id,work_date,hours,note) VALUES (?,?,?,?,'')");
  const insSub = db.prepare('INSERT OR IGNORE INTO daily_submissions (user_id,work_date) VALUES (?,?)');
  const jobByNo = no => legacyId[no];
  const log = (name, jobNo, hours, date = '2026-05-11') => { const jid = jobByNo(jobNo); if (jid) insTs.run(M[name], jid, date, hours); };
  // direct-to-job logger for the prior-year sample (costed at the 2025 rate tier)
  const logId = (name, jid, hours, date) => { if (jid && M[name]) insTs.run(M[name], jid, date, hours); };
  logId('Avishek', p25[0], 9, '2025-02-14'); logId('Shreyasi', p25[0], 14, '2025-02-18');
  logId('Shivani', p25[1], 11, '2025-09-12'); logId('Aritra', p25[1], 22, '2025-09-20'); logId('Anwesa', p25[1], 8, '2025-09-15');
  logId('Gaurab', p25[2], 16, '2025-06-25'); logId('Rahul', p25[2], 12, '2025-06-28');
  logId('Sanu', p25[3], 10, '2025-11-28'); logId('Adrija', p25[3], 4, '2025-11-26');
  logId('Adrija', p25[4], 6, '2025-04-04'); logId('Pronay', p25[4], 18, '2025-04-08'); logId('Srinjani', p25[4], 9, '2025-04-06');
  log('Saddam','4317_01',6); log('Adrija','4317_01',3);
  log('Gaurab','4304_07',4); log('Shivani','4304_07',2);
  log('Rahul','4321_02',6); log('Adrija','4321_02',2);
  log('Sanu','4207_60',3); log('Gaurab','4207_60',2); log('Tiyash','4207_60',1.5);
  log('Rahul','4301_10',5); log('Shivani','4301_10',2);
  log('Rahul','4318_07',3); log('Adrija','4318_07',1);
  log('Gaurab','4302_12',3); log('Avishek','4302_12',1);
  log('Aritra','4301_20',5);
  db.prepare("SELECT DISTINCT user_id FROM timesheet_entries WHERE work_date='2026-05-11'").all()
    .forEach(r => insSub.run(r.user_id, '2026-05-11'));

  // ---- Phase 4 seed: map every job to its team, a sample blocker, a little history ----
  const teamByName = {}; db.prepare('SELECT id,name FROM teams').all().forEach(t => teamByName[t.name] = t.id);
  const insJT = db.prepare('INSERT OR IGNORE INTO job_teams (job_id,team_id) VALUES (?,?)');
  db.prepare('SELECT id,team FROM jobs').all().forEach(j => { const tid = teamByName[j.team]; if (tid) insJT.run(j.id, tid); });
  // give one live job a second team, to show multi-team on the board
  const supraHotline = db.prepare("SELECT id FROM jobs WHERE brief='Hotline' LIMIT 1").get();
  if (supraHotline && teamByName['Studio']) insJT.run(supraHotline.id, teamByName['Studio']);

  // a sample open blocker on a live job
  const brandJob = db.prepare("SELECT id FROM jobs WHERE brief='Brand Identity' LIMIT 1").get();
  if (brandJob) db.prepare(`INSERT INTO issues (job_id,title,detail,severity,status,raised_by,assigned_to)
    VALUES (?,?,?,?, 'open', ?, ?)`).run(brandJob.id,
    'Awaiting final logo files from client', 'Client to share vector source before artworking can start.',
    'blocker', M.Adrija, M.Prakash);

  // a few audit-trail rows so the activity view isn't empty on first run
  const insAct = db.prepare(`INSERT INTO activity_log (actor_id,actor_name,entity_type,entity_id,job_id,action,field,old_value,new_value,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now',?))`);
  const seedAct = (actorName, etype, jobId, action, field, oldv, newv, note, ago) =>
    insAct.run(M[actorName] || null, actorName, etype, jobId, jobId, action, field || '', oldv || '', newv || '', note || '', ago);
  if (brandJob) {
    seedAct('Adrija', 'job', brandJob.id, 'created', '', '', 'Brand Identity', 'Job opened', '-9 days');
    seedAct('Adrija', 'assignment', brandJob.id, 'assigned', '', '', 'Prakash', 'Assigned to Art', '-9 days');
    seedAct('Adrija', 'issue', brandJob.id, 'raised', 'severity', '', 'blocker', 'Awaiting final logo files from client', '-2 days');
  }

  console.log(`Seeded 2.0 foundation. Super Admins: sanjay@${OFFICE_DOMAIN}, pawas@${OFFICE_DOMAIN}.`);
  console.log(`Default password for all seeded users: "${DEFAULT_PW}" (must change on first login).`);
}

if (require.main === module && process.argv.includes('--reseed')) {
  db.exec(`DELETE FROM activity_log; DELETE FROM issues; DELETE FROM job_teams; DELETE FROM user_permissions;
    DELETE FROM notifications; DELETE FROM brief_versions; DELETE FROM attachments;
    DELETE FROM subtasks; DELETE FROM workflow_stages;
    DELETE FROM approvals; DELETE FROM daily_submissions;
    DELETE FROM timesheet_entries; DELETE FROM job_assignments; DELETE FROM jobs;
    DELETE FROM cost_rates; DELETE FROM team_members; DELETE FROM clients;
    DELETE FROM users; DELETE FROM departments; DELETE FROM teams; DELETE FROM verticals;`);
  seed();
  console.log('Reseeded.');
} else if (!alreadySeeded()) {
  seed();
}

module.exports = { db, ROLES, ROLE_RANK, isBackend, isSuper, canSeeMoney, canSetRetainerCost,
  CAPABILITIES, ROLE_CAPS, capabilitiesOf, userHasCap,
  STAGES, APPROVAL, LEVEL_FOR_ROLE, NEXT_APPROVAL, OFFICE_DOMAIN };
