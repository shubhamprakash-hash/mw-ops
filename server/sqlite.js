/* ============================================================
   SQLite adapter with OPTIONAL at-rest encryption.

   Engine selection (first that works wins):
     1. If DB_ENCRYPTION_KEY is set  → better-sqlite3-multiple-ciphers
        (SQLCipher). The whole database file is transparently encrypted;
        all SQL — including SUMs and date filters used by the reports —
        keeps working unchanged, because decryption happens in the engine.
     2. Otherwise                    → better-sqlite3 (fast native, unencrypted)
     3. If that can't load           → Node's built-in node:sqlite (>=22.5)

   To turn encryption ON in production:
     • npm install better-sqlite3-multiple-ciphers   (bundled as an optional dep)
     • set DB_ENCRYPTION_KEY to a long secret and keep it safe — without it the
       database cannot be opened. Changing the key on an existing file won't work;
       export first, reset with the new key, then restore.
   ============================================================ */

function wrapNodeSqlite(DatabaseSync) {
  return class DB {
    constructor(p) { this._db = new DatabaseSync(p); }
    pragma(str) { try { this._db.exec('PRAGMA ' + str); } catch {} return this; }
    exec(sql) { this._db.exec(sql); return this; }
    prepare(sql) { return this._db.prepare(sql); }
    close() { this._db.close(); }
  };
}

function createDb(dbPath) {
  const key = process.env.DB_ENCRYPTION_KEY && String(process.env.DB_ENCRYPTION_KEY).trim();

  if (key) {
    try {
      const Cipher = require('better-sqlite3-multiple-ciphers');
      const db = new Cipher(dbPath);
      db.pragma("cipher='sqlcipher'");
      db.pragma(`key='${key.replace(/'/g, "''")}'`);
      db.prepare('SELECT count(*) FROM sqlite_master').get(); // fails fast on a wrong key
      console.log('[mw-ops] Database encryption: ON (SQLCipher, at rest).');
      db.__encrypted = true;
      return db;
    } catch (e) {
      console.warn('[mw-ops] DB_ENCRYPTION_KEY is set but encryption could NOT be enabled ('
        + e.message + '). Running UNENCRYPTED. Install "better-sqlite3-multiple-ciphers" to enable it.');
    }
  }

  try {
    const Database = require('better-sqlite3');
    return new Database(dbPath);
  } catch (e) {
    const { DatabaseSync } = require('node:sqlite');
    console.warn('[mw-ops] better-sqlite3 not available — using Node built-in SQLite (node:sqlite).');
    const DB = wrapNodeSqlite(DatabaseSync);
    return new DB(dbPath);
  }
}

module.exports = { createDb };
