/* ============================================================
   Middleware — authentication, role gates, timesheet gate
   ============================================================ */
const { db, isBackend, isSuper, userHasCap } = require('./db');
const { verifyToken } = require('./auth');

function requireAuth(req, res, next) {
  const token = req.cookies?.mw_token ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not signed in.' });
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.id);
  if (!u) return res.status(401).json({ error: 'Session no longer valid.' });
  req.user = u;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'You do not have access to this.' });
    next();
  };
}

// backend = admin + super_admin (masters, user management, operational admin)
function requireBackend(req, res, next) {
  if (!isBackend(req.user.role))
    return res.status(403).json({ error: 'Backend access required.' });
  next();
}

// super_admin only (kept for any super-exclusive surface)
function requireSuper(req, res, next) {
  if (!isSuper(req.user.role))
    return res.status(403).json({ error: 'Super Admin access required.' });
  next();
}

// capability gate — role default OR an explicit per-user grant (Phase 4)
function requireCap(cap) {
  return (req, res, next) => {
    if (!userHasCap(req.user, cap))
      return res.status(403).json({ error: 'You do not have access to this.' });
    next();
  };
}

/* ---------- Timesheet gate ----------
   A non-backend user may not view today's job list until they have submitted
   their timesheet for the most recent prior day on which they had active
   assigned jobs. Admins / super admins are exempt. */
function pendingTimesheetDay(userId, role) {
  if (isBackend(role)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT MAX(date(j.due_date)) AS d
    FROM job_assignments a JOIN jobs j ON j.id = a.job_id
    WHERE a.user_id = ?
      AND j.due_date <> '' AND date(j.due_date) < date(?)
      AND j.stage NOT IN ('Approved')
  `).get(userId, today);
  const day = row && row.d;
  if (!day) return null;
  const submitted = db.prepare(
    'SELECT 1 FROM daily_submissions WHERE user_id = ? AND work_date = ?'
  ).get(userId, day);
  return submitted ? null : day;
}

function gateJobList(req, res, next) {
  const owed = pendingTimesheetDay(req.user.id, req.user.role);
  if (owed) {
    return res.status(423).json({
      error: 'timesheet_gate',
      message: `Submit your timesheet for ${owed} to unlock today's job list.`,
      owed_date: owed
    });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireBackend, requireSuper, requireCap, gateJobList, pendingTimesheetDay };
