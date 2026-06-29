/* ============================================================
   SQLite adapter.
   Prefers better-sqlite3 (fast, production-grade). If it isn't
   installed / can't build, transparently falls back to Node's
   built-in node:sqlite so the app still runs with no native build.
   Both expose the same .prepare().run/get/all and .exec/.pragma API
   used across the codebase.
   ============================================================ */
let Database;
try {
  Database = require('better-sqlite3');           // normal path on a dev machine
  module.exports = Database;
} catch (e) {
  const { DatabaseSync } = require('node:sqlite'); // Node >= 22.5 built-in fallback
  console.warn('[mw-ops] better-sqlite3 not available — using Node built-in SQLite (node:sqlite).');

  class DB {
    constructor(path) { this._db = new DatabaseSync(path); }
    pragma(str) { try { this._db.exec('PRAGMA ' + str); } catch {} return this; }
    exec(sql) { this._db.exec(sql); return this; }
    prepare(sql) { return this._db.prepare(sql); }
    close() { this._db.close(); }
  }
  module.exports = DB;
}
