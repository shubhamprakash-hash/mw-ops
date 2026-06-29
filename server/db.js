/* ============================================================
   Monkey Wrench Ops — database (SQLite via better-sqlite3)
   Schema, roles, workflow constants, and seed data.
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

/* ---------- constants ---------- */
const ROLES = ['super_admin', 'admin', 'team_lead', 'member'];
// rank: higher number = more power. Used for "sees everything" checks.
const ROLE_RANK = { member: 1, team_lead: 2, admin: 3, super_admin: 4 };
const isAdmin = role => role === 'admin' || role === 'super_admin'; // backend + billing access
const canSeeMoney = role => isAdmin(role);

const STAGES = ['Pipeline', 'Pending', 'Studio', 'Review', 'Done', 'Approved'];
// approval pipeline once a job is completed and submitted:
const APPROVAL = ['none', 'submitted', 'lead_approved', 'admin_approved', 'approved', 'rejected'];
// which approval level each role acts on:
const LEVEL_FOR_ROLE = { team_lead: 'submitted', admin: 'lead_approved', super_admin: 'admin_approved' };
const NEXT_APPROVAL = { submitted: 'lead_approved', lead_approved: 'admin_approved', admin_approved: 'approved' };

const OFFICE_DOMAIN = process.env.OFFICE_DOMAIN || 'monkeywrench.in';

/* ---------- schema ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  team TEXT,
  job_role TEXT,                       -- AM / Copy / Art / Studio (craft)
  rate INTEGER DEFAULT 0,              -- INR per hour (money; hidden from non-admin)
  manager_id INTEGER REFERENCES users(id),
  password_hash TEXT NOT NULL,
  must_change_pw INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_no TEXT NOT NULL,
  ref_no TEXT DEFAULT '',
  client TEXT DEFAULT '',
  team TEXT DEFAULT '',
  stage TEXT DEFAULT 'Pipeline',
  task TEXT DEFAULT '',
  brief TEXT DEFAULT '',
  billing INTEGER DEFAULT 0,           -- money; hidden from non-admin
  due_date TEXT DEFAULT '',
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
  level TEXT NOT NULL,                 -- lead / admin / super
  approver_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,               -- approved / rejected
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ts_user_date ON timesheet_entries(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_assign_user ON job_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assign_job ON job_assignments(job_id);
`);

/* ---------- seed ---------- */
function alreadySeeded() {
  return db.prepare('SELECT COUNT(*) n FROM users').get().n > 0;
}

function seed() {
  const hash = pw => bcrypt.hashSync(pw, 10);
  const DEFAULT_PW = process.env.SEED_PASSWORD || 'changeme123';

  const insUser = db.prepare(`INSERT INTO users (email,name,role,team,job_role,rate,manager_id,password_hash,must_change_pw)
    VALUES (@email,@name,@role,@team,@job_role,@rate,@manager_id,@password_hash,@must_change_pw)`);

  const mk = (email, name, role, team, job_role, rate, manager_id = null, must = 1) =>
    insUser.run({ email: `${email}@${OFFICE_DOMAIN}`, name, role, team, job_role,
      rate, manager_id, password_hash: hash(DEFAULT_PW), must_change_pw: must }).lastInsertRowid;

  // leadership
  const superId = mk('founder', 'Founder', 'super_admin', null, null, 0, null, 1);
  const adminId = mk('ops', 'Ops Admin', 'admin', null, null, 0, superId, 1);

  // team leads (the "respective senior" for their team)
  const hornetLead = mk('shivani', 'Shivani', 'team_lead', 'Hornet', 'AM', 850, adminId);
  const raptorLead = mk('adrija', 'Adrija', 'team_lead', 'Raptor', 'AM', 850, adminId);
  const studioLead = mk('saddam', 'Saddam', 'team_lead', 'Studio', 'Studio', 550, adminId);

  // members
  const members = {
    // Hornet
    Kusumanjan: mk('kusumanjan', 'Kusumanjan', 'member', 'Hornet', 'AM', 900, hornetLead),
    Avishek:    mk('avishek', 'Avishek', 'member', 'Hornet', 'AM', 800, hornetLead),
    Anwesa:     mk('anwesa', 'Anwesa', 'member', 'Hornet', 'Copy', 700, hornetLead),
    Shreyasi:   mk('shreyasi', 'Shreyasi', 'member', 'Hornet', 'Art', 700, hornetLead),
    Prakash:    mk('prakash', 'Prakash', 'member', 'Hornet', 'Art', 800, hornetLead),
    // Raptor
    Srinjani:   mk('srinjani', 'Srinjani', 'member', 'Raptor', 'Copy', 650, raptorLead),
    Pronay:     mk('pronay', 'Pronay', 'member', 'Raptor', 'Art', 700, raptorLead),
    Aritra:     mk('aritra', 'Aritra', 'member', 'Raptor', 'Art', 800, raptorLead),
    Tiyash:     mk('tiyash', 'Tiyash', 'member', 'Raptor', 'AM', 800, raptorLead),
    Mrinmoyee:  mk('mrinmoyee', 'Mrinmoyee', 'member', 'Raptor', 'AM', 750, raptorLead),
    // Studio
    Gaurab:     mk('gaurab', 'Gaurab', 'member', 'Studio', 'Studio', 550, studioLead),
    Rahul:      mk('rahul', 'Rahul', 'member', 'Studio', 'Studio', 550, studioLead),
    Sanu:       mk('sanu', 'Sanu', 'member', 'Studio', 'Studio', 500, studioLead),
  };
  // leads are also assignable people
  members.Shivani = hornetLead; members.Adrija = raptorLead; members.Saddam = studioLead;

  // jobs (from the 11-May sheet) + who is assigned (resolved to user ids)
  const insJob = db.prepare(`INSERT INTO jobs (job_no,ref_no,client,team,stage,task,brief,billing,due_date,approval_stage,created_by)
    VALUES (@job_no,@ref_no,@client,@team,@stage,@task,@brief,@billing,@due_date,@approval_stage,@created_by)`);
  const insAssign = db.prepare(`INSERT OR IGNORE INTO job_assignments (job_id,user_id,role_on_job,assigned_by) VALUES (?,?,?,?)`);

  const J = (o, assignees) => {
    const row = Object.assign({ ref_no:'', client:'', team:'', stage:'Pipeline', task:'', brief:'',
      billing:0, due_date:'', approval_stage:'none', created_by: adminId }, o);
    const id = insJob.run(row).lastInsertRowid;
    (assignees || []).forEach(([name, craft]) => {
      const uid = members[name];
      if (uid) insAssign.run(id, uid, craft, hornetLead);
    });
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

  // Studio — completed, sitting in the approval pipeline at various stages (to show the workflow live)
  const s1 = J({job_no:'4317_01',ref_no:'4237_07',client:'OneHorn',team:'Studio',stage:'Done',task:'AW',brief:'Launch Campaign — Retail Collateral Instore 1x1, 1x2 (Odia, Telugu, Marathi)',billing:120000,due_date:'2026-05-11',approval_stage:'admin_approved'},
    [['Adrija','AM'],['Saddam','Studio']]);
  const s2 = J({job_no:'4317_01',ref_no:'4237_07',client:'OneHorn',team:'Studio',stage:'Done',task:'Modification',brief:'Launch Campaign — Retail Collateral Instore 2x1, 1x3, 3x1 (Hin, Ben, Odia, Tel, Mar)',billing:90000,due_date:'2026-05-11',approval_stage:'lead_approved'},
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

  // Review
  J({job_no:'4318_06',client:'Sawansukha',team:'Raptor',stage:'Review',task:'Review',brief:'Wedding Campaign — Golf — Gold & Diamond',billing:75000},
    [['Adrija','AM'],['Avishek','AM'],['Aritra','Art']]);
  J({job_no:'4301_20',client:'Supra',team:'Hornet',stage:'Review',task:'Ideation + Design',brief:'Capoo Launch A4 Poster',billing:24000,due_date:'2026-05-08'},
    [['Shivani','AM'],['Adrija','AM'],['Anwesa','Copy'],['Aritra','Art'],['Shreyasi','Art']]);

  // Pipeline
  J({job_no:'4213_03',client:'MW',team:'Studio',stage:'Pipeline',task:'',brief:'HR Kit Addition',billing:25000},[['Mrinmoyee','AM']]);
  J({job_no:'4301_10',client:'Supra',team:'Hornet',stage:'Pipeline',task:'Modification',brief:'Domestic Catalogue',billing:60000},[['Shivani','AM']]);
  J({job_no:'4330_01',client:'Red Pan — Bold Asian',team:'Hornet',stage:'Pipeline',task:'Design',brief:'Brand Identity',billing:160000},[['Adrija','AM'],['Anwesa','Copy'],['Prakash','Art']]);
  J({job_no:'4301_21',client:'Supra',team:'Hornet',stage:'Pipeline',task:'Design',brief:'Hotline',billing:20000},[['Shivani','AM'],['Adrija','AM'],['Shreyasi','Art']]);

  // sample timesheet entries + daily submissions (so the gate + costs are live)
  const insTs = db.prepare(`INSERT INTO timesheet_entries (user_id,job_id,work_date,hours,note) VALUES (?,?,?,?,'')`);
  const insSub = db.prepare(`INSERT OR IGNORE INTO daily_submissions (user_id,work_date) VALUES (?,?)`);
  const jobByNo = no => db.prepare('SELECT id FROM jobs WHERE job_no=? ORDER BY id LIMIT 1').get(no).id;
  const log = (name, jobNo, hours, date='2026-05-11') => insTs.run(members[name], jobByNo(jobNo), date, hours);

  log('Saddam','4317_01',6); log('Adrija','4317_01',3);
  log('Gaurab','4304_07',4); log('Shivani','4304_07',2);
  log('Rahul','4321_02',6); log('Adrija','4321_02',2);
  log('Sanu','4207_60',3); log('Gaurab','4207_60',2); log('Tiyash','4207_60',1.5);
  log('Rahul','4301_10',5); log('Shivani','4301_10',2);
  log('Rahul','4318_07',3); log('Adrija','4318_07',1);
  log('Gaurab','4302_12',3); log('Avishek','4302_12',1);
  log('Aritra','4301_20',5);

  // mark 11-May submitted for everyone who logged that day (so they're not gated for "today")
  const loggers = db.prepare(`SELECT DISTINCT user_id FROM timesheet_entries WHERE work_date='2026-05-11'`).all();
  loggers.forEach(r => insSub.run(r.user_id, '2026-05-11'));

  console.log(`Seeded. Default password for all seeded users: "${DEFAULT_PW}" (each must change on first login).`);
}

if (require.main === module && process.argv.includes('--reseed')) {
  db.exec(`DELETE FROM approvals; DELETE FROM daily_submissions; DELETE FROM timesheet_entries;
    DELETE FROM job_assignments; DELETE FROM jobs; DELETE FROM users;`);
  seed();
  console.log('Reseeded.');
} else if (!alreadySeeded()) {
  seed();
}

module.exports = { db, ROLES, ROLE_RANK, isAdmin, canSeeMoney, STAGES, APPROVAL,
  LEVEL_FOR_ROLE, NEXT_APPROVAL, OFFICE_DOMAIN };
