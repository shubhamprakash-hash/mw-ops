/* ============================================================
   Middleware — authentication, role gates, timesheet gate
   ============================================================ */
const { db, isAdmin } = require('./db');
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

// admin + super_admin only (backend, billing, P&L, user management)
function requireAdmin(req, res, next) {
  if (!isAdmin(req.user.role))
    return res.status(403).json({ error: 'Admin access required.' });
  next();
}

/* ---------- Timesheet gate ----------
   A user may not view today's job list until they have submitted their
   timesheet for the most recent prior working day on which they had
   active assigned jobs. Admins / super admins are exempt (they manage). */
function pendingTimesheetDay(userId, role) {
  if (isAdmin(role)) return null; // exempt
  const today = new Date().toISOString().slice(0, 10);
  // most recent past date (strictly before today) where this user had an active assignment
  const row = db.prepare(`
    SELECT MAX(date(j.due_date)) AS d
    FROM job_assignments a JOIN jobs j ON j.id = a.job_id
    WHERE a.user_id = ?
      AND j.due_date <> '' AND date(j.due_date) < date(?)
      AND j.stage NOT IN ('Approved')
  `).get(userId, today);
  const day = row && row.d;
  if (!day) return null; // nothing was due before today -> no gate
  const submitted = db.prepare(
    'SELECT 1 FROM daily_submissions WHERE user_id = ? AND work_date = ?'
  ).get(userId, day);
  return submitted ? null : day; // returns the date string they still owe
}

function gateJobList(req, res, next) {
  const owed = pendingTimesheetDay(req.user.id, req.user.role);
  if (owed) {
    return res.status(423).json({           // 423 Locked
      error: 'timesheet_gate',
      message: `Submit your timesheet for ${owed} to unlock today's job list.`,
      owed_date: owed
    });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireAdmin, gateJobList, pendingTimesheetDay };
