import {
  decryptStringWithAsymmetricKek,
  deriveCredentials,
} from '@repo/e2ee-auth/web';
import { type ImportExportSuiteNote } from '@repo/import-export-suite/web';

import {
  type ApiUserResponse,
  type KekMetadata,
} from '@/lib/auth-api';
import { type PersistedLinkedKek } from '@/lib/auth-storage';

export type AuthMode = 'login' | 'register';

export type DecryptedNote = {
  content: string;
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
};

export type MigrationProgress = {
  completed: number;
  total: number;
};

export type ApiUserView = ApiUserResponse & {
  label: string;
};

export async function decryptApiUserRecord(
  apiUser: ApiUserResponse,
  linkedKeks: PersistedLinkedKek[],
): Promise<ApiUserView> {
  const linkedKek = findLinkedKek(linkedKeks, apiUser.encryptedLabelDek.kekPublicKey);

  if (!linkedKek) {
    throw new Error(
      `Missing the local KEK for api user label ${apiUser.encryptedLabelDek.kekPublicKey}.`,
    );
  }

  return {
    ...apiUser,
    label: await decryptStringWithAsymmetricKek(
      {
        encryptedDek: apiUser.encryptedLabelDek,
        encryptedPayload: apiUser.encryptedLabel,
      },
      linkedKek.cryptKey,
    ),
  };
}

export function toNoteRecord(note: {
  content: string;
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
}) {
  return {
    content: note.content,
    createdAt: note.createdAt,
    id: note.id,
    title: note.title,
    updatedAt: note.updatedAt,
  };
}

export function buildInitialNoteSyncMessage(noteCount: number) {
  if (noteCount === 0) {
    return 'No synced notes yet. Create one to push ciphertext to the backend.';
  }

  return `Loaded ${noteCount} encrypted note${noteCount === 1 ? '' : 's'} from the local offline store.`;
}

export function buildOfflineSyncFailureMessage(noteCount: number, error: unknown) {
  if (noteCount > 0) {
    return `Loaded ${noteCount} offline note${noteCount === 1 ? '' : 's'}. Sync will resume when the backend is reachable.`;
  }

  return error instanceof Error ? error.message : 'Unable to sync encrypted notes.';
}

export function buildPostLoginNoteMessage(mode: AuthMode, noteCount: number) {
  if (noteCount > 0) {
    return `Loaded ${noteCount} offline note${noteCount === 1 ? '' : 's'} after login.`;
  }

  return mode === 'register'
    ? 'Account created. Create a note to push ciphertext to the backend.'
    : 'Logged in. Create a note to push ciphertext to the backend.';
}

export function buildKekMigrationMessage(rewrappedNoteCount: number, kekEpochVersion: number) {
  return `Rewrapped ${rewrappedNoteCount} DEK${rewrappedNoteCount === 1 ? '' : 's'} onto KEK epoch ${kekEpochVersion}.`;
}

export function sortNotes(notes: DecryptedNote[]) {
  return [...notes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function sortKekMetadatas(kekMetadatas: KekMetadata[]) {
  return [...kekMetadatas].sort(
    (left, right) => right.kekEpochVersion - left.kekEpochVersion,
  );
}

export function toBackupNote(note: DecryptedNote): ImportExportSuiteNote {
  return toNoteRecord(note);
}

export function buildImportExportSuiteFilename(exportedAt: string) {
  const safeTimestamp = exportedAt.replace(/[.:]/g, '-');

  return `import-export-suite-${safeTimestamp}.json`;
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function buildImportSummary(createdCount: number, updatedCount: number) {
  const segments = [];

  if (updatedCount > 0) {
    segments.push(`updated ${updatedCount}`);
  }

  if (createdCount > 0) {
    segments.push(`created ${createdCount}`);
  }

  return segments.length > 0
    ? `Imported notes: ${segments.join(' and ')}.`
    : 'The import file did not produce any note changes.';
}

export function mergeLinkedKeks(linkedKeks: PersistedLinkedKek[]) {
  const entriesByKekId = new Map<string, PersistedLinkedKek>();

  for (const linkedKek of linkedKeks) {
    entriesByKekId.set(linkedKek.kekPublicKey, linkedKek);
  }

  return [...entriesByKekId.values()].sort(
    (left, right) => right.kekEpochVersion - left.kekEpochVersion,
  );
}

export function findLinkedKek(linkedKeks: PersistedLinkedKek[], kekPublicKey: string) {
  return linkedKeks.find((linkedKek) => linkedKek.kekPublicKey === kekPublicKey) ?? null;
}

export function requireLinkedKek(linkedKeks: PersistedLinkedKek[], activeKekId: string | null) {
  if (!activeKekId) {
    throw new Error('No active KEK is linked on this device. Log in again.');
  }

  const linkedKek = findLinkedKek(linkedKeks, activeKekId);

  if (!linkedKek) {
    throw new Error('The active KEK is missing from local storage. Log in again.');
  }

  return linkedKek;
}

export function hasUnauthorizedStatus(error: unknown) {
  return !!error &&
    typeof error === 'object' &&
    'status' in error &&
    error.status === 401;
}

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export async function deriveMissingLinkedKeks({
  baseLinkedKeks,
  email,
  missingMetadatas,
  passwordsByKekId,
}: {
  baseLinkedKeks: PersistedLinkedKek[];
  email: string;
  missingMetadatas: KekMetadata[];
  passwordsByKekId: Record<string, string>;
}) {
  if (missingMetadatas.length === 0) {
    return baseLinkedKeks;
  }

  const saltHex = baseLinkedKeks[0]?.saltHex;

  if (!saltHex) {
    throw new Error('The current password salt is missing from local storage. Log in again.');
  }

  const derivedLinkedKeks = [...baseLinkedKeks];

  for (const metadata of missingMetadatas) {
    const password = passwordsByKekId[metadata.kekPublicKey]?.trim();

    if (!password) {
      throw new Error(
        `Enter the password for KEK epoch ${metadata.kekEpochVersion} before continuing the migration.`,
      );
    }

    const credentials = await deriveCredentials(email, password, saltHex);

    derivedLinkedKeks.push({
      cryptKey: credentials.cryptKey,
      kekEpochVersion: metadata.kekEpochVersion,
      kekPublicKey: metadata.kekPublicKey,
      saltHex,
    });
  }

  return mergeLinkedKeks(derivedLinkedKeks);
}