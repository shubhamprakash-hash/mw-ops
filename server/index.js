/* ============================================================
   Monkey Wrench Ops 2.0 — server entrypoint
   ============================================================ */
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { OFFICE_DOMAIN } = require('./db'); // initialises + seeds DB on first run
const auth = require('./auth');
const { requireAuth, requireBackend, requireSuper, requireCap } = require('./middleware');

const app = express();
app.use(express.json({ limit: '64mb' })); // large limit accommodates base64 attachments + full-backup restore
app.use(cookieParser());

const isProd = process.env.NODE_ENV === 'production';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 12 * 3600 * 1000 };

/* ---------- public ---------- */
app.get('/api/config', (req, res) =>
  res.json({ office_domain: OFFICE_DOMAIN }));

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const result = auth.login(email, password);
  if (result.error) return res.status(401).json(result);
  res.cookie('mw_token', result.token, cookieOpts);
  res.json({ user: result.user });
});
app.post('/api/logout', (req, res) => { res.clearCookie('mw_token'); res.json({ ok: true }); });

// Super-Admin self-service reset via emailed 6-digit code
app.post('/api/super-reset/request', async (req, res) => {
  await auth.requestSuperReset((req.body || {}).email);
  res.json({ ok: true }); // always generic (don't reveal which emails are super admins)
});
app.post('/api/super-reset/confirm', (req, res) => {
  const { email, code, new_password } = req.body || {};
  const r = auth.confirmSuperReset(email, code, new_password);
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true });
});

/* ---------- authenticated ---------- */
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
app.use('/api/notifications', requireAuth, require('./routes/notifications'));
app.use('/api/issues', requireAuth, require('./routes/issues'));
app.use('/api/custom-fields', requireAuth, require('./routes/customfields'));
// capability-gated (role defaults + per-user grants)
app.use('/api/masters', requireAuth, requireCap('manage_masters'), require('./routes/masters'));
app.use('/api/users', requireAuth, requireCap('manage_users'), require('./routes/users'));
app.use('/api/activity', requireAuth, requireCap('view_activity'), require('./routes/activity'));
app.use('/api/finance', requireAuth, requireCap('view_finance'), require('./routes/finance'));
// permissions administration + data management (super only)
app.use('/api/permissions', requireAuth, requireSuper, require('./routes/permissions'));
app.use('/api/data', requireAuth, requireSuper, require('./routes/data'));

/* ---------- static frontend ---------- */
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Monkey Wrench Ops 2.0 running → http://localhost:${PORT}`);
  console.log(`  Office domain: @${OFFICE_DOMAIN}\n`);
});
