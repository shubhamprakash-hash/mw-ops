/* ============================================================
   Routes: people — assignable members list (lead+ ; no money)
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, isBackend } = require('../db');
const { requireRole } = require('../middleware');
const { memberIdsOfLeadTeams } = require('../helpers');

router.get('/', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  let rows;
  if (isBackend(req.user.role)) {
    rows = db.prepare(`SELECT u.id,u.name,u.job_role,u.role,
      (SELECT GROUP_CONCAT(t.name,', ') FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=u.id) AS teams
      FROM users u WHERE u.active=1 ORDER BY u.name`).all();
  } else {
    const ids = memberIdsOfLeadTeams(req.user.id);
    if (!ids.length) return res.json([]);
    rows = db.prepare(`SELECT u.id,u.name,u.job_role,u.role,
      (SELECT GROUP_CONCAT(t.name,', ') FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=u.id) AS teams
      FROM users u WHERE u.active=1 AND u.id IN (${ids.map(() => '?').join(',')}) ORDER BY u.name`).all(...ids);
  }
  res.json(rows); // intentionally no rate field
});

module.exports = router;
