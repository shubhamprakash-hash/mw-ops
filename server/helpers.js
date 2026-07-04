/* ============================================================
   Helpers — dated cost engine, team derivation, job serialization
   ============================================================ */
const { db, canSeeMoney } = require('./db');

/* cost-per-hour effective on a given date (historical integrity) */
function costRateOn(userId, dateStr) {
  const row = db.prepare(`SELECT cost_per_hour FROM cost_rates
    WHERE user_id = ? AND date(effective_from) <= date(?)
    ORDER BY date(effective_from) DESC, id DESC LIMIT 1`).get(userId, dateStr);
  return row ? row.cost_per_hour : 0;
}
/* current cost rate for display in user management: the rate in effect *today*.
   (A future-dated rate isn't "current" yet — it still shows in the history modal.)
   If only future-dated rates exist, fall back to the soonest so the column isn't blank. */
function currentRate(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const now = db.prepare(`SELECT cost_per_hour FROM cost_rates
    WHERE user_id = ? AND date(effective_from) <= date(?)
    ORDER BY date(effective_from) DESC, id DESC LIMIT 1`).get(userId, today);
  if (now) return now.cost_per_hour;
  const soon = db.prepare(`SELECT cost_per_hour FROM cost_rates
    WHERE user_id = ? ORDER BY date(effective_from) ASC, id ASC LIMIT 1`).get(userId);
  return soon ? soon.cost_per_hour : 0;
}

/* a job's cost = each timesheet entry's hours × the rate effective on that entry's date */
function jobCost(jobId) {
  const rows = db.prepare('SELECT user_id, hours, work_date FROM timesheet_entries WHERE job_id = ?').all(jobId);
  return rows.reduce((s, r) => s + r.hours * costRateOn(r.user_id, r.work_date), 0);
}
const jobHours = jobId =>
  db.prepare('SELECT COALESCE(SUM(hours),0) h FROM timesheet_entries WHERE job_id = ?').get(jobId).h;

function assigneesOf(jobId) {
  return db.prepare(`SELECT a.user_id AS id, u.name, u.job_role AS craft, a.role_on_job
    FROM job_assignments a JOIN users u ON u.id = a.user_id
    WHERE a.job_id = ? ORDER BY u.name`).all(jobId);
}

/* ---- team helpers (teams are many-to-many now) ---- */
const teamsLedBy = userId =>
  db.prepare('SELECT id, name FROM teams WHERE lead_id = ? AND active = 1').all(userId);
const teamNamesLedBy = userId => teamsLedBy(userId).map(t => t.name);
const teamsOf = userId =>
  db.prepare(`SELECT t.id, t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ?`).all(userId);
const memberIdsOfLeadTeams = userId => db.prepare(`
  SELECT DISTINCT tm.user_id FROM team_members tm
  JOIN teams t ON t.id = tm.team_id WHERE t.lead_id = ?`).all(userId).map(r => r.user_id);

/* ---- structured job numbering: YEAR / ClientNo(4) / JobNo(2) / R{round} ---- */
const pad = (n, w) => String(n).padStart(w, '0');
function formatJobNo({ job_year, serial, job_seq, round }) {
  return `${job_year}/${pad(serial || 0, 4)}/${pad(job_seq || 1, 2)}/R${round || 1}`;
}
/* next number for a brand-new job under a client family */
function nextJobNumber(clientId) {
  const c = clientId ? db.prepare('SELECT seq_no FROM clients WHERE id = ?').get(clientId) : null;
  const serial = c && c.seq_no ? c.seq_no : 0;
  const job_year = new Date().getFullYear();
  const prev = db.prepare('SELECT COALESCE(MAX(job_seq),0) m FROM jobs WHERE client_id = ?').get(clientId || 0).m;
  const job_seq = prev + 1;
  const round = 1;
  return { job_year, serial, job_seq, round, job_no: formatJobNo({ job_year, serial, job_seq, round }) };
}

/* ---- notifications (the bell) ---- */
function notify(userIds, message, kind = 'info', jobId = null) {
  const ins = db.prepare('INSERT INTO notifications (user_id,kind,message,job_id) VALUES (?,?,?,?)');
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  ids.filter(Boolean).forEach(uid => ins.run(uid, kind, message, jobId));
}
const usersByRole = role => db.prepare('SELECT id FROM users WHERE role = ? AND active = 1').all(role).map(r => r.id);
const workflowStageName = id => {
  if (!id) return null;
  const r = db.prepare('SELECT name FROM workflow_stages WHERE id = ?').get(id);
  return r ? r.name : null;
};
const countWhere = (table, jobId) => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE job_id = ?`).get(jobId).n;

/* Build a job object appropriate for the viewer's role.
   Money (billing / cost / profit / margin) is included ONLY for super admins. */
/* a job's teams (many-to-many); falls back to the legacy single team field */
function jobTeams(jobId) {
  return db.prepare(`SELECT t.id, t.name FROM job_teams jt JOIN teams t ON t.id = jt.team_id
    WHERE jt.job_id = ? ORDER BY t.name`).all(jobId);
}
const jobTeamIds = jobId => jobTeams(jobId).map(t => t.id);
const jobTeamNames = jobId => jobTeams(jobId).map(t => t.name);

/* append-only audit trail. Accepts ids or names; snapshots the actor name. */
function logActivity({ actor, entity_type, entity_id = null, job_id = null, action,
  field = '', old_value = '', new_value = '', note = '' }) {
  const actor_id = actor && typeof actor === 'object' ? actor.id : actor;
  let actor_name = actor && typeof actor === 'object' ? actor.name : '';
  if (!actor_name && actor_id) {
    const u = db.prepare('SELECT name FROM users WHERE id = ?').get(actor_id);
    actor_name = u ? u.name : '';
  }
  db.prepare(`INSERT INTO activity_log
    (actor_id,actor_name,entity_type,entity_id,job_id,action,field,old_value,new_value,note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(actor_id || null, actor_name, entity_type,
    entity_id, job_id, action, String(field), String(old_value), String(new_value), String(note));
}

/* ---------- user-defined custom fields ---------- */
function customFieldDefs(entity) {
  return db.prepare('SELECT * FROM custom_fields WHERE entity=? AND active=1 ORDER BY position, id').all(entity);
}
function customValues(entity, recordId) {
  const out = {};
  db.prepare(`SELECT f.field_key, v.value FROM custom_fields f
    LEFT JOIN custom_field_values v ON v.field_id=f.id AND v.record_id=?
    WHERE f.entity=? AND f.active=1 ORDER BY f.position, f.id`).all(recordId, entity)
    .forEach(r => out[r.field_key] = (r.value == null ? '' : r.value));
  return out;
}
function setCustomValues(entity, recordId, custom) {
  if (!custom || typeof custom !== 'object') return;
  const defs = db.prepare('SELECT id, field_key FROM custom_fields WHERE entity=? AND active=1').all(entity);
  const up = db.prepare(`INSERT INTO custom_field_values (field_id,entity,record_id,value) VALUES (?,?,?,?)
    ON CONFLICT(field_id,record_id) DO UPDATE SET value=excluded.value`);
  defs.forEach(d => { if (Object.prototype.hasOwnProperty.call(custom, d.field_key)) up.run(d.id, entity, recordId, String(custom[d.field_key] ?? '')); });
}

function serializeJob(job, viewer) {
  const teams = jobTeams(job.id);
  const out = {
    id: job.id, job_no: job.job_no, ref_no: job.ref_no,
    job_year: job.job_year, serial: job.serial, job_seq: job.job_seq, round: job.round,
    client: job.client, client_id: job.client_id, vertical_id: job.vertical_id,
    team: job.team, teams, team_ids: teams.map(t => t.id), stage: job.stage,
    workflow_stage_id: job.workflow_stage_id, workflow_stage: workflowStageName(job.workflow_stage_id),
    task: job.task, brief: job.brief,
    job_date: job.job_date, due_date: job.due_date, delivery_date: job.delivery_date,
    approval_stage: job.approval_stage, reject_note: job.reject_note,
    assignees: assigneesOf(job.id), hours: jobHours(job.id),
    subtasks_total: countWhere('subtasks', job.id),
    subtasks_done: db.prepare('SELECT COUNT(*) n FROM subtasks WHERE job_id = ? AND done = 1').get(job.id).n,
    attachments: countWhere('attachments', job.id),
    brief_versions: countWhere('brief_versions', job.id),
    open_issues: db.prepare("SELECT COUNT(*) n FROM issues WHERE job_id = ? AND status = 'open'").get(job.id).n,
    custom: customValues('job', job.id),
  };
  if (canSeeMoney(viewer)) {
    const cost = jobCost(job.id);
    out.billing = job.billing;
    out.cost = cost;
    out.profit = job.billing - cost;
    out.margin = job.billing ? (job.billing - cost) / job.billing * 100 : 0;
  }
  return out;
}

module.exports = { costRateOn, currentRate, jobCost, jobHours, assigneesOf,
  teamsLedBy, teamNamesLedBy, teamsOf, memberIdsOfLeadTeams, serializeJob,
  jobTeams, jobTeamIds, jobTeamNames, logActivity,
  customFieldDefs, customValues, setCustomValues,
  formatJobNo, nextJobNumber, notify, usersByRole };
