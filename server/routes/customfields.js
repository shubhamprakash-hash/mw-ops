/* ============================================================
   Routes: custom-fields — user-defined fields on core records.
   Reading definitions: any signed-in user (forms need them).
   Add / rename / modify / remove: Super Admin only.
   ============================================================ */
const express = require('express');
const router = express.Router();
const { db, isSuper } = require('../db');
const { logActivity } = require('../helpers');

const ENTITIES = ['job', 'client'];
const TYPES = ['text', 'number', 'date', 'select', 'textarea'];
const superOnly = (req, res, next) =>
  isSuper(req.user.role) ? next() : res.status(403).json({ error: 'Super Admin access required.' });

function slug(label, entity) {
  let base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
  let key = base, n = 1;
  while (db.prepare('SELECT 1 FROM custom_fields WHERE entity=? AND field_key=?').get(entity, key)) key = `${base}_${++n}`;
  return key;
}
const clean = f => ({ ...f, active: !!f.active });

/* list fields for an entity (active only, unless ?all=1 by a super) */
router.get('/', (req, res) => {
  const entity = ENTITIES.includes(req.query.entity) ? req.query.entity : null;
  const showAll = req.query.all === '1' && isSuper(req.user.role);
  const where = entity ? 'WHERE entity=?' + (showAll ? '' : ' AND active=1') : (showAll ? '' : 'WHERE active=1');
  const rows = db.prepare(`SELECT * FROM custom_fields ${where} ORDER BY entity, position, id`)
    .all(...(entity ? [entity] : []));
  res.json(rows.map(clean));
});

router.post('/', superOnly, (req, res) => {
  const { entity, label, type, options } = req.body || {};
  if (!ENTITIES.includes(entity)) return res.status(400).json({ error: 'Unknown record type.' });
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'A field name is required.' });
  const t = TYPES.includes(type) ? type : 'text';
  const pos = (db.prepare('SELECT COALESCE(MAX(position),0) m FROM custom_fields WHERE entity=?').get(entity).m) + 1;
  const info = db.prepare(`INSERT INTO custom_fields (entity,field_key,label,type,options,position,created_by)
    VALUES (?,?,?,?,?,?,?)`).run(entity, slug(label, entity), String(label).trim(), t, String(options || ''), pos, req.user.id);
  logActivity({ actor: req.user, entity_type: 'custom_field', entity_id: info.lastInsertRowid, action: 'created',
    field: entity, new_value: String(label).trim() });
  res.status(201).json(clean(db.prepare('SELECT * FROM custom_fields WHERE id=?').get(info.lastInsertRowid)));
});

router.put('/:id', superOnly, (req, res) => {
  const f = db.prepare('SELECT * FROM custom_fields WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Field not found.' });
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.label != null && String(b.label).trim()) { sets.push('label=?'); vals.push(String(b.label).trim()); }
  if (b.type && TYPES.includes(b.type)) { sets.push('type=?'); vals.push(b.type); }
  if (b.options != null) { sets.push('options=?'); vals.push(String(b.options)); }
  if (b.position != null) { sets.push('position=?'); vals.push(+b.position || 0); }
  if (b.active != null) { sets.push('active=?'); vals.push(b.active ? 1 : 0); }
  if (sets.length) { vals.push(f.id); db.prepare(`UPDATE custom_fields SET ${sets.join(',')} WHERE id=?`).run(...vals); }
  logActivity({ actor: req.user, entity_type: 'custom_field', entity_id: f.id, action: 'updated',
    field: f.entity, old_value: f.label, new_value: b.label || f.label });
  res.json(clean(db.prepare('SELECT * FROM custom_fields WHERE id=?').get(f.id)));
});

/* remove a field entirely (its stored values cascade away) */
router.delete('/:id', superOnly, (req, res) => {
  const f = db.prepare('SELECT * FROM custom_fields WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Field not found.' });
  db.prepare('DELETE FROM custom_fields WHERE id=?').run(f.id);
  logActivity({ actor: req.user, entity_type: 'custom_field', entity_id: f.id, action: 'deleted',
    field: f.entity, old_value: f.label });
  res.json({ ok: true });
});

module.exports = router;
