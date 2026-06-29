/* ============================================================
   Routes: people — assignable members list (lead+ ; no money)
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, isAdmin } = require('../db');
const { requireRole } = require('../middleware');

// Team leads see their own team; admins see everyone. Used for assignment dropdowns.
router.get('/', requireRole('super_admin', 'admin', 'team_lead'), (req, res) => {
  let rows;
  if (isAdmin(req.user.role)) {
    rows = db.prepare(`SELECT id,name,team,job_role,role FROM users WHERE active=1 ORDER BY team,name`).all();
  } else {
    rows = db.prepare(`SELECT id,name,team,job_role,role FROM users
      WHERE active=1 AND team=? ORDER BY name`).all(req.user.team);
  }
  res.json(rows); // intentionally no rate field
});

module.exports = router;
