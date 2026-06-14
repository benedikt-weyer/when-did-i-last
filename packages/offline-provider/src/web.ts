import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

import type { OfflineChange, OfflineNotesDatabase, StoredOfflineNote } from './core';
import { OfflineNotesProvider } from './core';

const DEFAULT_STORAGE_KEY = 'offline-provider-notes-db';
type WebSqlParams = NonNullable<Parameters<Database['prepare']>[1]>;

export function createWebOfflineNotesProvider(options?: {
  storageKey?: string;
  wasmPath?: string;
}) {
  return new OfflineNotesProvider(
    new WebOfflineNotesDatabase(options?.storageKey ?? DEFAULT_STORAGE_KEY, options?.wasmPath),
  );
}

class WebOfflineNotesDatabase implements OfflineNotesDatabase {
  private database: Database | null = null;

  private sql: SqlJsStatic | null = null;

  constructor(
    private readonly storageKey: string,
    private readonly wasmPath = '/vendor/sql-wasm.wasm',
  ) {}

  async init() {
    if (this.database) {
      return;
    }

    this.sql = await initSqlJs({
      locateFile: () => this.wasmPath,
    });

    const persistedBytes = readPersistedDatabase(this.storageKey);

    this.database = persistedBytes
      ? new this.sql.Database(persistedBytes)
      : new this.sql.Database();

    this.database.run(SCHEMA_SQL);
    this.persist();
  }

  async listNotes() {
    return this.readRows<StoredOfflineNote>(
      'SELECT id, title, content, created_at, updated_at, is_local_only FROM notes',
      mapNoteRow,
    );
  }

  async getNote(noteId: string) {
    return this.readOne<StoredOfflineNote>(
      'SELECT id, title, content, created_at, updated_at, is_local_only FROM notes WHERE id = ?',
      [noteId],
      mapNoteRow,
    );
  }

  async upsertNote(note: StoredOfflineNote) {
    this.requireDatabase().run(
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
    this.persist();
  }

  async deleteNote(noteId: string) {
    this.requireDatabase().run('DELETE FROM notes WHERE id = ?', [noteId]);
    this.persist();
  }

  async listChanges() {
    return this.readRows<OfflineChange>(
      'SELECT note_id, change_type, changed_at FROM offline_changes',
      mapChangeRow,
    );
  }

  async upsertChange(change: OfflineChange) {
    this.requireDatabase().run(
      `INSERT INTO offline_changes (note_id, change_type, changed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET
         change_type = excluded.change_type,
         changed_at = excluded.changed_at`,
      [change.noteId, change.type, change.changedAt],
    );
    this.persist();
  }

  async deleteChange(noteId: string) {
    this.requireDatabase().run('DELETE FROM offline_changes WHERE note_id = ?', [noteId]);
    this.persist();
  }

  private readRows<T>(
    query: string,
    mapRow: (row: Record<string, unknown>) => T,
    params?: WebSqlParams,
  ) {
    const statement = this.requireDatabase().prepare(query, params);
    const rows: T[] = [];

    while (statement.step()) {
      rows.push(mapRow(statement.getAsObject() as Record<string, unknown>));
    }

    statement.free();
    return rows;
  }

  private readOne<T>(
    query: string,
    params: WebSqlParams,
    mapRow: (row: Record<string, unknown>) => T,
  ) {
    const rows = this.readRows(query, mapRow, params);

    return rows[0] ?? null;
  }

  private persist() {
    if (!this.database || typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(this.storageKey, encodeBytes(this.database.export()));
    } catch {
      // Leave the in-memory database active when local storage is unavailable.
    }
  }

  private requireDatabase() {
    if (!this.database) {
      throw new Error('The web offline notes database has not been initialized.');
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

function readPersistedDatabase(storageKey: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const payload = window.localStorage.getItem(storageKey);

    return payload ? decodeBytes(payload) : null;
  } catch {
    return null;
  }
}

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

function encodeBytes(bytes: Uint8Array) {
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}

function decodeBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}