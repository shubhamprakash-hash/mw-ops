/* ============================================================
   Auth — JWT issue/verify, login, password change
   ============================================================ */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, OFFICE_DOMAIN } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production';
const TOKEN_TTL = '12h';

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, team: u.team,
    job_role: u.job_role, manager_id: u.manager_id, must_change_pw: !!u.must_change_pw };
}

function issueToken(u) {
  return jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

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

module.exports = { publicUser, issueToken, verifyToken, login, changePassword, OFFICE_DOMAIN };
