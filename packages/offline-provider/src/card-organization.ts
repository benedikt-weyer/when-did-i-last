export const MAX_FOLDER_DEPTH = 20;

export type CardOrganization = {
  folderId: string | null;
  kind: 'card';
  lastDoneAt: string | null;
};

export type FolderOrganization = {
  kind: 'folder';
  parentFolderId: string | null;
};

export type NoteOrganization = CardOrganization | FolderOrganization;

export function parseNoteOrganization(value: string): NoteOrganization {
  try {
    const parsed = JSON.parse(value) as Partial<{
      folderId: unknown;
      kind: unknown;
      lastDoneAt: unknown;
      parentFolderId: unknown;
      version: unknown;
    }>;

    if (parsed?.version === 1 && parsed.kind === 'folder') {
      return {
        kind: 'folder',
        parentFolderId: normalizeOptionalId(parsed.parentFolderId),
      };
    }

    if (parsed?.version === 1 && parsed.kind === 'card') {
      return {
        folderId: normalizeOptionalId(parsed.folderId),
        kind: 'card',
        lastDoneAt: normalizeLastDoneAt(parsed.lastDoneAt),
      };
    }
  } catch {
    // Legacy card content is a timestamp string.
  }

  return {
    folderId: null,
    kind: 'card',
    lastDoneAt: normalizeLastDoneAt(value),
  };
}

export function serializeCardOrganization({
  folderId,
  lastDoneAt,
}: Pick<CardOrganization, 'folderId' | 'lastDoneAt'>) {
  return JSON.stringify({
    folderId: normalizeOptionalId(folderId),
    kind: 'card',
    lastDoneAt: normalizeLastDoneAt(lastDoneAt),
    version: 1,
  });
}

export function serializeFolderOrganization(parentFolderId: string | null) {
  return JSON.stringify({
    kind: 'folder',
    parentFolderId: normalizeOptionalId(parentFolderId),
    version: 1,
  });
}

function normalizeOptionalId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeLastDoneAt(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) {
    return null;
  }

  return value;
}
