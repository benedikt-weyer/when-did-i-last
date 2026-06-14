import type { OfflineNotesProvider, OfflineNotesSyncAdapter } from '@repo/offline-provider';

import type { AuthApiResponse } from '../auth/auth-api';
import { fetchNotes, updateNote, type NoteResponse, type SaveNotePayload } from './test-note-api';
import { getNativeAuthModule, getNativeOfflineNotesProviderModule } from './native-runtime';

let mobileOfflineNotesProviderPromise: Promise<OfflineNotesProvider> | null = null;

export async function getMobileOfflineNotesProvider() {
  if (!mobileOfflineNotesProviderPromise) {
    mobileOfflineNotesProviderPromise = getNativeOfflineNotesProviderModule().then(
      ({ createNativeOfflineNotesProvider }) => createNativeOfflineNotesProvider(),
    );
  }

  return mobileOfflineNotesProviderPromise;
}

type RunWithFreshSession = <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;

export function createMobileOfflineNotesSyncAdapter({
  activeKekId,
  backendUrl,
  linkedKeks,
  runWithFreshSession,
  session,
}: {
  activeKekId: string;
  backendUrl: string;
  linkedKeks: { cryptKey: Uint8Array; kekPublicKey: string }[];
  runWithFreshSession: RunWithFreshSession;
  session: AuthApiResponse;
}): OfflineNotesSyncAdapter<NoteResponse> {
  return {
    async deleteRemoteNote(noteId) {
      await runWithFreshSession(async (activeSession) => {
        await fetch(buildNoteUrl(backendUrl, noteId), {
          headers: {
            Authorization: `Bearer ${activeSession.token}`,
          },
          method: 'DELETE',
        }).then(readDeleteResponse);
      });
    },
    fetchRemoteNotes() {
      return runWithFreshSession((activeSession) =>
        fetchNotes({
          baseUrl: backendUrl,
          token: activeSession.token,
        }),
      );
    },
    getRemoteId(note) {
      return note.id;
    },
    getRemoteUpdatedAt(note) {
      return note.updatedAt;
    },
    isMissingDeleteError(error) {
      return hasStatus(error, 404);
    },
    async materializeRemoteNote(note) {
      const { decryptStringWithAsymmetricKek } = await getNativeAuthModule();
      const linkedKek = requireLinkedKek(linkedKeks, note.encryptedDek.kekPublicKey);
      const decryptedDocument = deserializeNoteDocument(
        await decryptStringWithAsymmetricKek(note, linkedKek.cryptKey),
      );

      return {
        content: decryptedDocument.content,
        createdAt: note.createdAt,
        id: note.id,
        isLocalOnly: false,
        title: decryptedDocument.title,
        updatedAt: note.updatedAt,
      };
    },
    async upsertRemoteNote(note) {
      const { encryptStringWithAsymmetricKek } = await getNativeAuthModule();
      const linkedKek = requireLinkedKek(linkedKeks, activeKekId);
      const encryptedPayload = await encryptStringWithAsymmetricKek(
        serializeNoteDocument({
          content: note.content,
          title: note.title,
        }),
        linkedKek.kekPublicKey,
      );
      const payload: SaveNotePayload = {
        encryptedDeks: [
          {
            ...encryptedPayload.encryptedDek,
            userId: session.user.id,
          },
        ],
        encryptedPayload: encryptedPayload.encryptedPayload,
      };
      const savedNote = await runWithFreshSession((activeSession) =>
        updateNote({
          baseUrl: backendUrl,
          noteId: note.id,
          payload,
          token: activeSession.token,
        }),
      );

      return {
        createdAt: savedNote.createdAt,
        id: savedNote.id,
        updatedAt: savedNote.updatedAt,
      };
    },
  };
}

function serializeNoteDocument(note: { content: string; title: string }) {
  return JSON.stringify({
    lastDoneAt: normalizeLastDoneAt(note.content),
    question: note.title,
  });
}

function deserializeNoteDocument(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<{
      content: string;
      lastDoneAt: string | null;
      question: string;
      title: string;
    }>;

    if (
      typeof parsed?.question === 'string' &&
      (typeof parsed.lastDoneAt === 'string' || parsed.lastDoneAt === null || parsed.lastDoneAt === undefined)
    ) {
      return {
        content: parsed.lastDoneAt ?? '',
        title: parsed.question,
      };
    }

    if (typeof parsed?.title === 'string' && typeof parsed?.content === 'string') {
      return {
        content: normalizeLastDoneAt(parsed.content) ?? '',
        title: parsed.title || parsed.content,
      };
    }
  } catch {
    // Fall back to treating legacy values as question-only text.
  }

  return {
    content: '',
    title: value,
  };
}

function requireLinkedKek(
  linkedKeks: { cryptKey: Uint8Array; kekPublicKey: string }[],
  kekPublicKey: string,
) {
  const linkedKek = linkedKeks.find((entry) => entry.kekPublicKey === kekPublicKey) ?? null;

  if (!linkedKek) {
    throw new Error(`Missing the local KEK for note ${kekPublicKey}.`);
  }

  return linkedKek;
}

function buildNoteUrl(baseUrl: string, noteId: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');

  if (!normalizedBaseUrl) {
    throw new Error('Enter the backend URL before syncing cards.');
  }

  return `${normalizedBaseUrl}/api/cards/${encodeURIComponent(noteId.trim())}`;
}

function normalizeLastDoneAt(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  return Number.isNaN(Date.parse(trimmedValue)) ? null : trimmedValue;
}

async function readDeleteResponse(response: Response) {
  const responseBody = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw withResponseStatus(
      new Error(
        responseBody && typeof responseBody.error === 'string'
          ? responseBody.error
          : 'The backend rejected the note request.',
      ),
      response.status,
    );
  }
}

function withResponseStatus(error: Error, status: number) {
  return Object.assign(error, { status });
}

function hasStatus(error: unknown, status: number) {
  return !!error && typeof error === 'object' && 'status' in error && error.status === status;
}