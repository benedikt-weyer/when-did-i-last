import { v4 as uuidv4 } from 'uuid';

export type OfflineNote = {
  content: string;
  createdAt: string;
  id: string;
  isLocalOnly: boolean;
  pendingSync: boolean;
  title: string;
  updatedAt: string;
};

export type OfflineNotesSnapshot = {
  isReady: boolean;
  isSyncing: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  notes: OfflineNote[];
  pendingChangeCount: number;
};

export type OfflineNoteDraft = {
  content: string;
  id?: string;
  title: string;
};

export type StoredOfflineNote = {
  content: string;
  createdAt: string;
  id: string;
  isLocalOnly: boolean;
  title: string;
  updatedAt: string;
};

export type OfflineChangeType = 'delete' | 'upsert';

export type OfflineChange = {
  changedAt: string;
  noteId: string;
  type: OfflineChangeType;
};

export type SyncedNoteMetadata = {
  createdAt: string;
  id: string;
  updatedAt: string;
};

export interface OfflineNotesDatabase {
  close?(): Promise<void>;
  deleteChange(noteId: string): Promise<void>;
  deleteNote(noteId: string): Promise<void>;
  getNote(noteId: string): Promise<StoredOfflineNote | null>;
  init(): Promise<void>;
  listChanges(): Promise<OfflineChange[]>;
  listNotes(): Promise<StoredOfflineNote[]>;
  upsertChange(change: OfflineChange): Promise<void>;
  upsertNote(note: StoredOfflineNote): Promise<void>;
}

export interface OfflineNotesSyncAdapter<TRemoteNote> {
  deleteRemoteNote(noteId: string): Promise<void>;
  fetchRemoteNotes(): Promise<TRemoteNote[]>;
  getRemoteId(note: TRemoteNote): string;
  getRemoteUpdatedAt(note: TRemoteNote): string;
  isMissingDeleteError?(error: unknown): boolean;
  materializeRemoteNote(note: TRemoteNote): Promise<StoredOfflineNote>;
  upsertRemoteNote(note: StoredOfflineNote): Promise<SyncedNoteMetadata>;
}

type SnapshotOverride = Partial<
  Pick<OfflineNotesSnapshot, 'isReady' | 'isSyncing' | 'lastSyncAt' | 'lastSyncError'>
>;

export class OfflineNotesProvider {
  private listeners = new Set<() => void>();

  private snapshot: OfflineNotesSnapshot = {
    isReady: false,
    isSyncing: false,
    lastSyncAt: null,
    lastSyncError: null,
    notes: [],
    pendingChangeCount: 0,
  };

  private syncPromise: Promise<void> | null = null;

  constructor(private readonly database: OfflineNotesDatabase) {}

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async initialize() {
    await this.database.init();
    await this.refreshSnapshot({ isReady: true });
  }

  async saveNote(draft: OfflineNoteDraft) {
    const existingNote = draft.id ? await this.database.getNote(draft.id) : null;
    const now = new Date().toISOString();
    const note: StoredOfflineNote = existingNote
      ? {
          ...existingNote,
          content: draft.content,
          title: draft.title,
          updatedAt: now,
        }
      : {
          content: draft.content,
          createdAt: now,
          id: draft.id ?? uuidv4(),
          isLocalOnly: true,
          title: draft.title,
          updatedAt: now,
        };

    await this.database.upsertNote(note);
    await this.database.upsertChange({
      changedAt: now,
      noteId: note.id,
      type: 'upsert',
    });
    await this.refreshSnapshot();

    return this.requireNote(note.id);
  }

  async deleteNote(noteId: string) {
    const existingNote = await this.database.getNote(noteId);

    if (!existingNote) {
      await this.database.deleteChange(noteId);
      await this.refreshSnapshot();
      return;
    }

    if (existingNote.isLocalOnly) {
      await this.database.deleteNote(noteId);
      await this.database.deleteChange(noteId);
      await this.refreshSnapshot();
      return;
    }

    await this.database.deleteNote(noteId);
    await this.database.upsertChange({
      changedAt: new Date().toISOString(),
      noteId,
      type: 'delete',
    });
    await this.refreshSnapshot();
  }

  async sync<TRemoteNote>(adapter: OfflineNotesSyncAdapter<TRemoteNote>) {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = this.performSync(adapter).finally(() => {
      this.syncPromise = null;
    });

    return this.syncPromise;
  }

  async close() {
    if (this.database.close) {
      await this.database.close();
    }
  }

  private async performSync<TRemoteNote>(adapter: OfflineNotesSyncAdapter<TRemoteNote>) {
    await this.refreshSnapshot({ isSyncing: true, lastSyncError: null });

    try {
      const pendingChanges = toChangeMap(await this.database.listChanges());

      for (const change of pendingChanges.values()) {
        if (change.type !== 'delete') {
          continue;
        }

        try {
          await adapter.deleteRemoteNote(change.noteId);
        } catch (error) {
          if (!adapter.isMissingDeleteError?.(error)) {
            throw error;
          }
        }

        await this.database.deleteChange(change.noteId);
        await this.database.deleteNote(change.noteId);
      }

      const remoteNotes = await adapter.fetchRemoteNotes();
      const remoteNotesById = new Map(remoteNotes.map((note) => [adapter.getRemoteId(note), note]));
      const localNotes = await this.database.listNotes();
      const remainingChanges = toChangeMap(await this.database.listChanges());

      for (const localNote of localNotes) {
        if (remoteNotesById.has(localNote.id) || localNote.isLocalOnly) {
          continue;
        }

        await this.database.deleteNote(localNote.id);
        await this.database.deleteChange(localNote.id);
        remainingChanges.delete(localNote.id);
      }

      for (const change of remainingChanges.values()) {
        if (change.type !== 'upsert') {
          continue;
        }

        const localNote = await this.database.getNote(change.noteId);

        if (!localNote) {
          await this.database.deleteChange(change.noteId);
          continue;
        }

        const remoteNote = remoteNotesById.get(localNote.id);

        if (!remoteNote) {
          if (!localNote.isLocalOnly) {
            await this.database.deleteNote(localNote.id);
            await this.database.deleteChange(localNote.id);
            continue;
          }

          const syncedNote = await adapter.upsertRemoteNote(localNote);

          await this.database.upsertNote({
            ...localNote,
            createdAt: syncedNote.createdAt,
            id: syncedNote.id,
            isLocalOnly: false,
            updatedAt: syncedNote.updatedAt,
          });
          await this.database.deleteChange(localNote.id);

          if (syncedNote.id !== localNote.id) {
            await this.database.deleteNote(localNote.id);
          }

          continue;
        }

        if (localNote.updatedAt > adapter.getRemoteUpdatedAt(remoteNote)) {
          const syncedNote = await adapter.upsertRemoteNote(localNote);

          await this.database.upsertNote({
            ...localNote,
            createdAt: syncedNote.createdAt,
            id: syncedNote.id,
            isLocalOnly: false,
            updatedAt: syncedNote.updatedAt,
          });
          await this.database.deleteChange(localNote.id);

          if (syncedNote.id !== localNote.id) {
            await this.database.deleteNote(localNote.id);
          }

          continue;
        }

        await this.database.upsertNote({
          ...(await adapter.materializeRemoteNote(remoteNote)),
          isLocalOnly: false,
        });
        await this.database.deleteChange(localNote.id);
      }

      const remainingChangeIds = new Set((await this.database.listChanges()).map((change) => change.noteId));

      for (const remoteNote of remoteNotes) {
        const remoteId = adapter.getRemoteId(remoteNote);

        if (remainingChangeIds.has(remoteId)) {
          continue;
        }

        const localNote = await this.database.getNote(remoteId);

        if (!localNote || adapter.getRemoteUpdatedAt(remoteNote) > localNote.updatedAt) {
          await this.database.upsertNote({
            ...(await adapter.materializeRemoteNote(remoteNote)),
            isLocalOnly: false,
          });
        }
      }

      await this.refreshSnapshot({
        isSyncing: false,
        lastSyncAt: new Date().toISOString(),
        lastSyncError: null,
      });
    } catch (error) {
      await this.refreshSnapshot({
        isSyncing: false,
        lastSyncError: error instanceof Error ? error.message : 'Offline sync failed.',
      });
      throw error;
    }
  }

  private async refreshSnapshot(override: SnapshotOverride = {}) {
    const notes = await this.database.listNotes();
    const changes = await this.database.listChanges();
    const changeIds = new Set(changes.map((change) => change.noteId));

    this.snapshot = {
      ...this.snapshot,
      ...override,
      notes: sortNotes(notes).map((note) => ({
        ...note,
        pendingSync: changeIds.has(note.id),
      })),
      pendingChangeCount: changes.length,
    };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private requireNote(noteId: string) {
    const note = this.snapshot.notes.find((entry) => entry.id === noteId);

    if (!note) {
      throw new Error('The local note store did not return the saved note.');
    }

    return note;
  }
}

function sortNotes(notes: StoredOfflineNote[]) {
  return [...notes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function toChangeMap(changes: OfflineChange[]) {
  return new Map(changes.map((change) => [change.noteId, change]));
}