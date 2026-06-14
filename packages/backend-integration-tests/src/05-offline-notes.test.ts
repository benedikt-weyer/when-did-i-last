import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  decryptStringWithAsymmetricKek,
  encryptStringWithAsymmetricKeks,
} from '@repo/e2ee-auth/web';
import {
  OfflineNotesProvider,
  type OfflineChange,
  type OfflineNotesDatabase,
  type OfflineNotesSyncAdapter,
  type StoredOfflineNote,
} from '@repo/offline-provider';
import { describe, expect, it } from 'vitest';

import {
  bindWrappedDeks,
  createOwnedNote,
  latestKek,
  queryRows,
  registerAndLoginUser,
  requestJson,
  toAsymmetricPayload,
  type NoteResponse,
  useIntegrationSuite,
} from './integration-support';

useIntegrationSuite();

describe('offline notes flow', () => {
  it('syncs offline creates, resolves update conflicts by updatedAt, and makes deletes win against newer remote updates', async () => {
    const registered = await registerAndLoginUser();
    const ownerKek = latestKek(registered.login);
    const seededRemoteNote = await createOwnedNote({
      ownerKekPublicKey: ownerKek.kekPublicKey,
      ownerToken: registered.login.token,
      ownerUserId: registered.login.user.id,
      plaintext: serializeNoteDocument({
        content: 'Remote original content',
        title: 'Remote seed',
      }),
    });
    const provider = new OfflineNotesProvider(new InMemoryOfflineNotesDatabase());
    const adapter = createBackendOfflineAdapter({
      cryptKey: registered.credentials.cryptKey,
      kekPublicKey: ownerKek.kekPublicKey,
      token: registered.login.token,
      userId: registered.login.user.id,
    });

    await provider.initialize();
    await provider.sync(adapter);

    expect(readRequiredNote(provider, seededRemoteNote.id)).toMatchObject({
      content: 'Remote original content',
      pendingSync: false,
      title: 'Remote seed',
    });

    const localOnlyNote = await provider.saveNote({
      content: 'Created while offline',
      title: 'Offline draft',
    });
    await provider.saveNote({
      content: 'Local stale edit',
      id: seededRemoteNote.id,
      title: 'Local stale title',
    });

    expect(provider.getSnapshot().pendingChangeCount).toBe(2);

    await delay(25);
    await upsertBackendOwnedNote({
      content: 'Remote newer content',
      kekPublicKey: ownerKek.kekPublicKey,
      noteId: seededRemoteNote.id,
      title: 'Remote newer title',
      token: registered.login.token,
      userId: registered.login.user.id,
    });

    await provider.sync(adapter);

    expect(readRequiredNote(provider, seededRemoteNote.id)).toMatchObject({
      content: 'Remote newer content',
      isLocalOnly: false,
      pendingSync: false,
      title: 'Remote newer title',
    });
    expect(readRequiredNote(provider, localOnlyNote.id)).toMatchObject({
      content: 'Created while offline',
      id: localOnlyNote.id,
      isLocalOnly: false,
      pendingSync: false,
      title: 'Offline draft',
    });

    const syncedOfflineNote = await requestJson<NoteResponse>(`/api/notes/${localOnlyNote.id}`, {
      token: registered.login.token,
    });

    await expect(
      decryptStringWithAsymmetricKek(toAsymmetricPayload(syncedOfflineNote), registered.credentials.cryptKey),
    ).resolves.toBe(
      serializeNoteDocument({
        content: 'Created while offline',
        title: 'Offline draft',
      }),
    );
    expect(provider.getSnapshot().pendingChangeCount).toBe(0);

    await provider.deleteNote(seededRemoteNote.id);
    await delay(25);
    await upsertBackendOwnedNote({
      content: 'Remote resurrected content',
      kekPublicKey: ownerKek.kekPublicKey,
      noteId: seededRemoteNote.id,
      title: 'Remote resurrected title',
      token: registered.login.token,
      userId: registered.login.user.id,
    });

    await provider.sync(adapter);

    expect(readOptionalNote(provider, seededRemoteNote.id)).toBeUndefined();

    const remainingRemoteNotes = await requestJson<NoteResponse[]>('/api/notes', {
      token: registered.login.token,
    });

    expect(remainingRemoteNotes.map((note) => note.id)).toEqual([localOnlyNote.id]);

    const storedRows = await queryRows<{ id: string }>(
      'select id from notes where user_id = $1 order by id asc',
      [registered.login.user.id],
    );

    expect(storedRows.map((row) => row.id)).toEqual([localOnlyNote.id]);
  });

  it('removes local notes when the server copy is deleted and no local change is pending', async () => {
    const registered = await registerAndLoginUser();
    const ownerKek = latestKek(registered.login);
    const remoteNote = await createOwnedNote({
      ownerKekPublicKey: ownerKek.kekPublicKey,
      ownerToken: registered.login.token,
      ownerUserId: registered.login.user.id,
      plaintext: serializeNoteDocument({
        content: 'Remote note to delete',
        title: 'Server owned',
      }),
    });
    const provider = new OfflineNotesProvider(new InMemoryOfflineNotesDatabase());
    const adapter = createBackendOfflineAdapter({
      cryptKey: registered.credentials.cryptKey,
      kekPublicKey: ownerKek.kekPublicKey,
      token: registered.login.token,
      userId: registered.login.user.id,
    });

    await provider.initialize();
    await provider.sync(adapter);

    expect(readRequiredNote(provider, remoteNote.id).title).toBe('Server owned');

    await requestJson<boolean>(`/api/notes/${remoteNote.id}`, {
      method: 'DELETE',
      token: registered.login.token,
    });
    await provider.sync(adapter);

    expect(readOptionalNote(provider, remoteNote.id)).toBeUndefined();
  });
});

function createBackendOfflineAdapter(input: {
  cryptKey: Uint8Array;
  kekPublicKey: string;
  token: string;
  userId: string;
}): OfflineNotesSyncAdapter<NoteResponse> {
  return {
    async deleteRemoteNote(noteId) {
      await requestJson<boolean>(`/api/notes/${noteId}`, {
        method: 'DELETE',
        token: input.token,
      });
    },
    fetchRemoteNotes() {
      return requestJson<NoteResponse[]>('/api/notes', {
        token: input.token,
      });
    },
    getRemoteId(note) {
      return note.id;
    },
    getRemoteUpdatedAt(note) {
      return note.updatedAt;
    },
    async materializeRemoteNote(note) {
      const serializedDocument = await decryptStringWithAsymmetricKek(
        toAsymmetricPayload(note),
        input.cryptKey,
      );
      const document = deserializeNoteDocument(serializedDocument);

      return {
        content: document.content,
        createdAt: note.createdAt,
        id: note.id,
        isLocalOnly: false,
        title: document.title,
        updatedAt: note.updatedAt,
      };
    },
    async upsertRemoteNote(note) {
      const response = await upsertBackendOwnedNote({
        content: note.content,
        kekPublicKey: input.kekPublicKey,
        noteId: note.id,
        title: note.title,
        token: input.token,
        userId: input.userId,
      });

      return {
        createdAt: response.createdAt,
        id: response.id,
        updatedAt: response.updatedAt,
      };
    },
  };
}

async function upsertBackendOwnedNote(input: {
  content: string;
  kekPublicKey: string;
  noteId: string;
  title: string;
  token: string;
  userId: string;
}) {
  const encryptedNote = await encryptStringWithAsymmetricKeks(
    serializeNoteDocument({
      content: input.content,
      title: input.title,
    }),
    [input.kekPublicKey],
  );

  return await requestJson<NoteResponse>(`/api/notes/${input.noteId}`, {
    body: {
      encryptedDeks: bindWrappedDeks(encryptedNote.encryptedDeks, [input.userId]),
      encryptedPayload: encryptedNote.encryptedPayload,
    },
    method: 'PUT',
    token: input.token,
  });
}

class InMemoryOfflineNotesDatabase implements OfflineNotesDatabase {
  private readonly changes = new Map<string, OfflineChange>();

  private readonly notes = new Map<string, StoredOfflineNote>();

  async deleteChange(noteId: string) {
    this.changes.delete(noteId);
  }

  async deleteNote(noteId: string) {
    this.notes.delete(noteId);
  }

  async getNote(noteId: string) {
    const note = this.notes.get(noteId);

    return note ? cloneStoredNote(note) : null;
  }

  async init() {}

  async listChanges() {
    return [...this.changes.values()].map((change) => ({ ...change }));
  }

  async listNotes() {
    return [...this.notes.values()].map((note) => cloneStoredNote(note));
  }

  async upsertChange(change: OfflineChange) {
    this.changes.set(change.noteId, { ...change });
  }

  async upsertNote(note: StoredOfflineNote) {
    this.notes.set(note.id, cloneStoredNote(note));
  }
}

function serializeNoteDocument(note: { content: string; title: string }) {
  return JSON.stringify(note);
}

function deserializeNoteDocument(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<{ content: string; title: string }>;

    if (typeof parsed?.title === 'string' && typeof parsed?.content === 'string') {
      return {
        content: parsed.content,
        title: parsed.title,
      };
    }
  } catch {
    // Fall back to content-only text for legacy plaintext notes.
  }

  return {
    content: value,
    title: '',
  };
}

function cloneStoredNote(note: StoredOfflineNote): StoredOfflineNote {
  return {
    content: note.content,
    createdAt: note.createdAt,
    id: note.id,
    isLocalOnly: note.isLocalOnly,
    title: note.title,
    updatedAt: note.updatedAt,
  };
}

function readOptionalNote(provider: OfflineNotesProvider, noteId: string) {
  return provider.getSnapshot().notes.find((note) => note.id === noteId);
}

function readRequiredNote(provider: OfflineNotesProvider, noteId: string) {
  const note = readOptionalNote(provider, noteId);

  expect(note).toBeDefined();

  return note!;
}