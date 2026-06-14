import {
  openDatabaseAsync,
  type SQLiteBindParams,
  type SQLiteDatabase,
} from 'expo-sqlite';

import type { OfflineChange, OfflineNotesDatabase, StoredOfflineNote } from './core';
import { OfflineNotesProvider } from './core';

const DEFAULT_DATABASE_NAME = 'offline-provider-notes.db';

export function createNativeOfflineNotesProvider(options?: { databaseName?: string }) {
  return new OfflineNotesProvider(
    new NativeOfflineNotesDatabase(options?.databaseName ?? DEFAULT_DATABASE_NAME),
  );
}

class NativeOfflineNotesDatabase implements OfflineNotesDatabase {
  private database: SQLiteDatabase | null = null;

  constructor(private readonly databaseName: string) {}

  async init() {
    if (this.database) {
      return;
    }

    this.database = await openDatabaseAsync(this.databaseName);
    await this.database.execAsync(SCHEMA_SQL);
  }

  async listNotes() {
    const rows = await this.requireDatabase().getAllAsync<Record<string, unknown>>(
      'SELECT id, title, content, created_at, updated_at, is_local_only FROM notes',
    );

    return rows.map(mapNoteRow);
  }

  async getNote(noteId: string) {
    const row = await this.requireDatabase().getFirstAsync<Record<string, unknown>>(
      'SELECT id, title, content, created_at, updated_at, is_local_only FROM notes WHERE id = ?',
      [noteId],
    );

    return row ? mapNoteRow(row) : null;
  }

  async upsertNote(note: StoredOfflineNote) {
    await this.run(
      `INSERT INTO notes (id, title, content, created_at, updated_at, is_local_only)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         content = excluded.content,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         is_local_only = excluded.is_local_only`,
      [
        note.id,
        note.title,
        note.content,
        note.createdAt,
        note.updatedAt,
        note.isLocalOnly ? 1 : 0,
      ],
    );
  }

  async deleteNote(noteId: string) {
    await this.run('DELETE FROM notes WHERE id = ?', [noteId]);
  }

  async listChanges() {
    const rows = await this.requireDatabase().getAllAsync<Record<string, unknown>>(
      'SELECT note_id, change_type, changed_at FROM offline_changes',
    );

    return rows.map(mapChangeRow);
  }

  async upsertChange(change: OfflineChange) {
    await this.run(
      `INSERT INTO offline_changes (note_id, change_type, changed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET
         change_type = excluded.change_type,
         changed_at = excluded.changed_at`,
      [change.noteId, change.type, change.changedAt],
    );
  }

  async deleteChange(noteId: string) {
    await this.run('DELETE FROM offline_changes WHERE note_id = ?', [noteId]);
  }

  private async run(query: string, params: SQLiteBindParams) {
    await this.requireDatabase().runAsync(query, params);
  }

  private requireDatabase() {
    if (!this.database) {
      throw new Error('The native offline notes database has not been initialized.');
    }

    return this.database;
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_local_only INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS offline_changes (
    note_id TEXT PRIMARY KEY,
    change_type TEXT NOT NULL,
    changed_at TEXT NOT NULL
  );
`;

function mapNoteRow(row: Record<string, unknown>): StoredOfflineNote {
  return {
    content: String(row.content ?? ''),
    createdAt: String(row.created_at ?? ''),
    id: String(row.id ?? ''),
    isLocalOnly: Number(row.is_local_only ?? 0) === 1,
    title: String(row.title ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function mapChangeRow(row: Record<string, unknown>): OfflineChange {
  return {
    changedAt: String(row.changed_at ?? ''),
    noteId: String(row.note_id ?? ''),
    type: row.change_type === 'delete' ? 'delete' : 'upsert',
  };
}