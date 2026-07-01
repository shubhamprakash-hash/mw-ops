/* ============================================================
   Auth — JWT issue/verify, login, password change,
          Super-Admin emailed-code reset
   ============================================================ */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, OFFICE_DOMAIN, capabilitiesOf } = require('./db');
const { teamsOf } = require('./helpers');
const { sendMail } = require('./mailer');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production';
const TOKEN_TTL = '12h';
const RESET_CODE_TTL_MIN = 15;

function publicUser(u) {
  if (!u) return null;
  const dept = u.department_id
    ? db.prepare('SELECT name FROM departments WHERE id = ?').get(u.department_id) : null;
  const caps = capabilitiesOf(u);
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, job_role: u.job_role,
    department_id: u.department_id, department: dept ? dept.name : null,
    reports_to: u.reports_to, teams: teamsOf(u.id).map(t => t.name),
    capabilities: [...caps],
    can_see_money: caps.has('view_finance'),
    must_change_pw: !!u.must_change_pw,
  };
}

const issueToken = u => jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: TOKEN_TTL });
function verifyToken(token) { try { return jwt.verify(token, SECRET); } catch { return null; } }

function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (!email.endsWith('@' + OFFICE_DOMAIN))
    return { error: `Use your office email (@${OFFICE_DOMAIN}).` };
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
    return { error: 'Email or password is incorrect.' };
  return { token: issueToken(u), user: publicUser(u) };
}

function changePassword(userId, oldPw, newPw) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return { error: 'User not found.' };
  if (!bcrypt.compareSync(String(oldPw || ''), u.password_hash))
    return { error: 'Current password is incorrect.' };
  if (String(newPw || '').length < 8) return { error: 'New password must be at least 8 characters.' };
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?')
    .run(bcrypt.hashSync(newPw, 10), userId);
  return { ok: true };
}

/* ---- Super-Admin self-service reset via emailed code ---- */
async function requestSuperReset(email) {
  email = String(email || '').trim().toLowerCase();
  // Only Super Admins may use this path. Always respond generically.
  const u = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1 AND role = 'super_admin'").get(email);
  if (u) {
    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    const expires = new Date(Date.now() + RESET_CODE_TTL_MIN * 60000).toISOString();
    db.prepare('UPDATE reset_codes SET used = 1 WHERE user_id = ? AND used = 0').run(u.id); // invalidate old codes
    db.prepare('INSERT INTO reset_codes (user_id, code, expires_at) VALUES (?,?,?)').run(u.id, code, expires);
    await sendMail({
      to: u.email,
      subject: 'Your Monkey Wrench Ops reset code',
      text: `Hi ${u.name},\n\nYour password-reset code is: ${code}\nIt is valid for ${RESET_CODE_TTL_MIN} minutes.\n\nIf you didn't request this, you can ignore this message.`,
    });
  }
  return { ok: true };
}

function confirmSuperReset(email, code, newPw) {
  email = String(email || '').trim().toLowerCase();
  if (String(newPw || '').length < 8) return { error: 'New password must be at least 8 characters.' };
  const u = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1 AND role = 'super_admin'").get(email);
  if (!u) return { error: 'Invalid email or code.' };
  const row = db.prepare('SELECT * FROM reset_codes WHERE user_id = ? AND code = ? AND used = 0')
    .get(u.id, String(code || '').trim());
  if (!row) return { error: 'Invalid email or code.' };
  if (new Date(row.expires_at) < new Date()) return { error: 'That code has expired — request a new one.' };
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?')
    .run(bcrypt.hashSync(newPw, 10), u.id);
  db.prepare('UPDATE reset_codes SET used = 1 WHERE id = ?').run(row.id);
  return { ok: true };
}

module.exports = { publicUser, issueToken, verifyToken, login, changePassword,
  requestSuperReset, confirmSuperReset, OFFICE_DOMAIN };
