// Database setup (kept separate from routing). Creates tables on first run.
const Database = require('better-sqlite3');
const path = require('path');

const { DB_PATH } = require('./paths');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL UNIQUE,
  qr_code_path VARCHAR(255),
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  activity_type VARCHAR(10) NOT NULL CHECK (activity_type IN ('IN','OUT')),
  timestamp     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_att_member ON attendance(member_id, id);
`);

// Upgrade databases created before the 'active' column existed.
if (!db.prepare('PRAGMA table_info(members)').all().some(c => c.name === 'active'))
  db.exec('ALTER TABLE members ADD COLUMN active INTEGER NOT NULL DEFAULT 1');

module.exports = db;
