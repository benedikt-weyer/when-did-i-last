import {
  createWebOfflineNotesSyncAdapter,
  webOfflineNotesProvider,
} from '@/lib/offline-notes';
import { type AuthApiResponse } from '@/lib/auth-api';
import { type PersistedLinkedKek } from '@/lib/auth-storage';

import {
  sortNotes,
  toNoteRecord,
  type DecryptedNote,
} from './session-page-helpers';
import { type RunWithSessionRetry } from './session-page';

export function getOfflineNoteSnapshot(): DecryptedNote[] {
  return sortNotes(
    webOfflineNotesProvider.getSnapshot().notes.map((note) => toNoteRecord(note)),
  );
}

export async function syncOfflineNotes({
  linkedKeks,
  nextSession,
  runWithSessionRetry,
  trimmedBackendUrl,
}: {
  linkedKeks: PersistedLinkedKek[];
  nextSession: AuthApiResponse;
  runWithSessionRetry: RunWithSessionRetry;
  trimmedBackendUrl: string;
}): Promise<DecryptedNote[]> {
  const adapter = await createWebOfflineNotesSyncAdapter({
    backendUrl: trimmedBackendUrl,
    linkedKeks,
    runWithSessionRetry,
    session: nextSession,
  });

  await webOfflineNotesProvider.sync(adapter);

  return getOfflineNoteSnapshot();
}

export { webOfflineNotesProvider };