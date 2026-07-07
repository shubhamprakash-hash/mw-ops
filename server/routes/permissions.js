/* ============================================================
   Routes: permissions — granular per-user capability administration.
   Mounted under requireSuper at /api/permissions.
   A Super Admin can GRANT a capability to a user, REVOKE a role default,
   or CLEAR the override (revert to the role default).
   ============================================================ */
const express = require('express');
const router = express.Router();
const dbm = require('../db');
const { logActivity: log } = require('../helpers');

const CAP_LABELS = {
  view_finance: 'View financials',
  manage_masters: 'Manage masters',
  manage_users: 'Manage users',
  view_activity: 'View activity log',
  manage_jobs: 'Create & assign jobs',
};

router.get('/', (req, res) => {
  const users = dbm.db.prepare(`SELECT id,name,email,role FROM users WHERE active=1 ORDER BY
    CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 WHEN 'team_lead' THEN 2 ELSE 3 END, name`).all();
  const overrides = {};
  dbm.db.prepare('SELECT user_id,capability,granted FROM user_permissions').all()
    .forEach(r => { (overrides[r.user_id] = overrides[r.user_id] || {})[r.capability] = !!r.granted; });
  const rows = users.map(u => {
    const roleDefault = new Set(dbm.ROLE_CAPS[u.role] || []);
    const ov = overrides[u.id] || {};
    const caps = dbm.CAPABILITIES.map(cap => {
      const def = roleDefault.has(cap);
      const override = (cap in ov) ? ov[cap] : null;          // true grant / false revoke / null none
      const effective = override === null ? def : override;
      return { cap, label: CAP_LABELS[cap] || cap, default: def, override, effective };
    });
    return { id: u.id, name: u.name, email: u.email, role: u.role, caps };
  });
  res.json({ users: rows, capabilities: dbm.CAPABILITIES.map(c => ({ cap: c, label: CAP_LABELS[c] || c })) });
});

/* set or clear one capability override for a user.
   body: { capability, value }  where value = true | false | null (clear) */
router.put('/:userId', (req, res) => {
  const userId = +req.params.userId;
  const { capability, value } = req.body || {};
  const u = dbm.db.prepare('SELECT id,name,role FROM users WHERE id=? AND active=1').get(userId);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (!dbm.CAPABILITIES.includes(capability)) return res.status(400).json({ error: 'Unknown capability.' });
  if (value === null || value === undefined) {
    dbm.db.prepare('DELETE FROM user_permissions WHERE user_id=? AND capability=?').run(userId, capability);
  } else {
    dbm.db.prepare(`INSERT INTO user_permissions (user_id,capability,granted,granted_by)
      VALUES (?,?,?,?) ON CONFLICT(user_id,capability) DO UPDATE SET granted=excluded.granted, granted_by=excluded.granted_by`)
      .run(userId, capability, value ? 1 : 0, req.user.id);
  }
  log({ actor: req.user, entity_type: 'user', entity_id: userId, action: 'updated',
    field: 'capability:' + capability, new_value: value === null || value === undefined ? 'cleared' : (value ? 'granted' : 'revoked'),
    note: u.name });
  res.json({ ok: true, capabilities: [...dbm.capabilitiesOf(u)] });
});

module.exports = router;
