/* ============================================================
   Helpers — serialize jobs (hide money from non-admins), cost math
   ============================================================ */
const { db, isAdmin } = require('./db');

const rateOf = userId => {
  const u = db.prepare('SELECT rate FROM users WHERE id = ?').get(userId);
  return u ? u.rate : 0;
};

function jobCost(jobId) {
  const rows = db.prepare(`
    SELECT t.hours, u.rate FROM timesheet_entries t JOIN users u ON u.id = t.user_id
    WHERE t.job_id = ?`).all(jobId);
  return rows.reduce((s, r) => s + r.hours * r.rate, 0);
}
const jobHours = jobId =>
  db.prepare('SELECT COALESCE(SUM(hours),0) h FROM timesheet_entries WHERE job_id = ?').get(jobId).h;

function assigneesOf(jobId) {
  return db.prepare(`
    SELECT a.user_id AS id, u.name, u.job_role AS craft, a.role_on_job, u.team
    FROM job_assignments a JOIN users u ON u.id = a.user_id
    WHERE a.job_id = ? ORDER BY u.name`).all(jobId);
}

// Build a job object appropriate for the viewer's role.
function serializeJob(job, viewerRole) {
  const out = {
    id: job.id, job_no: job.job_no, ref_no: job.ref_no, client: job.client,
    team: job.team, stage: job.stage, task: job.task, brief: job.brief,
    due_date: job.due_date, approval_stage: job.approval_stage,
    reject_note: job.reject_note,
    assignees: assigneesOf(job.id),
    hours: jobHours(job.id),
  };
  if (isAdmin(viewerRole)) {
    const cost = jobCost(job.id);
    out.billing = job.billing;
    out.cost = cost;
    out.profit = job.billing - cost;
    out.margin = job.billing ? (job.billing - cost) / job.billing * 100 : 0;
  }
  // money fields simply absent for team leads / members
  return out;
}

module.exports = { rateOf, jobCost, jobHours, assigneesOf, serializeJob };
