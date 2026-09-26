import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path, { timeout: 5_000 });
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    database.exec('BEGIN IMMEDIATE');
    const version = database.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('The account database schema is newer than this server.');
    if (version === 0) {
      database.exec(readFileSync(new URL('./migrations/001_accounts.sql', import.meta.url), 'utf8'));
      database.exec('PRAGMA user_version = 1');
    }
    database.exec('COMMIT');
    return database;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    database.close();
    throw error;
  }
}
