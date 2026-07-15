import type { SaveNotePayload } from './test-note-api';

export type FolderResponse = {
  createdAt: string;
  encryptedDek: SaveNotePayload['encryptedDeks'][number];
  encryptedPayload: SaveNotePayload['encryptedPayload'];
  id: string;
  updatedAt: string;
};

export async function fetchFolders({ baseUrl, token }: { baseUrl: string; token: string }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/folders`, { headers: { Authorization: `Bearer ${token}` } });
  return readResponse<FolderResponse[]>(response, 'folders');
}

export async function saveFolder({ baseUrl, folderId, payload, token }: { baseUrl: string; folderId?: string; payload: SaveNotePayload; token: string }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/folders${folderId ? `/${encodeURIComponent(folderId)}` : ''}`, {
    body: JSON.stringify(payload), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, method: folderId ? 'PUT' : 'POST',
  });
  return readResponse<FolderResponse>(response, 'folder');
}

export async function deleteFolder({ baseUrl, folderId, token }: { baseUrl: string; folderId: string; token: string }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/folders/${encodeURIComponent(folderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    method: 'DELETE',
  });
  await readResponse<boolean>(response, 'folder deletion');
}

function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('Enter the backend URL before syncing folders.');
  return normalized;
}

async function readResponse<T>(response: Response, label: string): Promise<T> {
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'The backend rejected the folder request.');
  if (!body) throw new TypeError(`The backend returned an invalid ${label} payload.`);
  return body as T;
}
