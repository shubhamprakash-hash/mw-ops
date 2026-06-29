/* ============================================================
   Monkey Wrench Ops — server entrypoint
   ============================================================ */
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { db, OFFICE_DOMAIN } = require('./db'); // initialises + seeds DB on first run
const auth = require('./auth');
const { requireAuth } = require('./middleware');

const app = express();
app.use(express.json());
app.use(cookieParser());

const isProd = process.env.NODE_ENV === 'production';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 12 * 3600 * 1000 };

/* ---------- public config ---------- */
app.get('/api/config', (req, res) => res.json({ office_domain: OFFICE_DOMAIN }));

/* ---------- auth (public) ---------- */
app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const result = auth.login(email, password);
  if (result.error) return res.status(401).json(result);
  res.cookie('mw_token', result.token, cookieOpts);
  res.json({ user: result.user });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('mw_token');
  res.json({ ok: true });
});

/* ---------- everything below requires a session ---------- */
app.get('/api/me', requireAuth, (req, res) => res.json({ user: auth.publicUser(req.user) }));

app.post('/api/change-password', requireAuth, (req, res) => {
  const { old_password, new_password } = req.body || {};
  const r = auth.changePassword(req.user.id, old_password, new_password);
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true });
});

app.use('/api/jobs', requireAuth, require('./routes/jobs'));
app.use('/api/timesheets', requireAuth, require('./routes/timesheets'));
app.use('/api/approvals', requireAuth, require('./routes/approvals'));
app.use('/api/people', requireAuth, require('./routes/people'));
app.use('/api/admin', requireAuth, require('./routes/admin'));

/* ---------- static frontend ---------- */
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Monkey Wrench Ops running → http://localhost:${PORT}`);
  console.log(`  Office domain: @${OFFICE_DOMAIN}\n`);
});
