import {
  decryptStringWithAsymmetricKek,
  encryptStringWithAsymmetricKeks,
} from '@repo/e2ee-auth/web';
import type { OfflineNotesSyncAdapter } from '@repo/offline-provider';
import { createWebOfflineNotesProvider } from '@repo/offline-provider/web';

import {
  fetchLinkedPrincipals,
  type AuthApiResponse,
} from '@/lib/auth-api';
import type { PersistedLinkedKek } from '@/lib/auth-storage';
import { fetchNotes, updateNote, type NoteResponse } from '@/lib/test-note-api';

export const webOfflineNotesProvider = createWebOfflineNotesProvider();

type RunWithSessionRetry = <T>(
  currentSession: AuthApiResponse,
  trimmedBackendUrl: string,
  callback: (activeSession: AuthApiResponse) => Promise<T>,
) => Promise<T>;

export async function createWebOfflineNotesSyncAdapter({
  backendUrl,
  linkedKeks,
  runWithSessionRetry,
  session,
}: {
  backendUrl: string;
  linkedKeks: PersistedLinkedKek[];
  runWithSessionRetry: RunWithSessionRetry;
  session: AuthApiResponse;
}): Promise<OfflineNotesSyncAdapter<NoteResponse>> {
  const linkedPrincipals = await runWithSessionRetry(session, backendUrl, (activeSession) =>
    fetchLinkedPrincipals({
      baseUrl: backendUrl,
      token: activeSession.token,
    }),
  );

  return {
    async deleteRemoteNote(noteId) {
      await runWithSessionRetry(session, backendUrl, async (activeSession) => {
        await fetch(buildNoteUrl(backendUrl, noteId), {
          headers: {
            Authorization: `Bearer ${activeSession.token}`,
          },
          method: 'DELETE',
        }).then(readDeleteResponse);
      });
    },
    fetchRemoteNotes() {
      return runWithSessionRetry(session, backendUrl, (activeSession) =>
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
      const encryptedPayload = await encryptStringWithAsymmetricKeks(
        serializeNoteDocument({
          content: note.content,
          title: note.title,
        }),
        linkedPrincipals.map((principal) => principal.latestKekPublicKey),
      );
      const payload = {
        encryptedDeks: encryptedPayload.encryptedDeks.map((encryptedDek, index) => {
          const principal = linkedPrincipals[index];

          if (!principal) {
            throw new Error('The backend returned an incomplete linked principal list.');
          }

          return {
            ...encryptedDek,
            userId: principal.id,
          };
        }),
        encryptedPayload: encryptedPayload.encryptedPayload,
      };
      const savedNote = await runWithSessionRetry(session, backendUrl, (activeSession) =>
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

function requireLinkedKek(linkedKeks: PersistedLinkedKek[], kekPublicKey: string) {
  const linkedKek = linkedKeks.find((entry) => entry.kekPublicKey === kekPublicKey) ?? null;

  if (!linkedKek) {
    throw new Error(`Missing the local KEK for note ${kekPublicKey}.`);
  }

  return linkedKek;
}

function buildNoteUrl(baseUrl: string, noteId: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');

  if (!normalizedBaseUrl) {
    throw new Error('Set API_BASE_URL for the web app before syncing cards.');
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