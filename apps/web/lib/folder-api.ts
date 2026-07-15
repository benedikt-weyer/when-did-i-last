import type { KekAsymmetricDekEncryptedPayload } from '@repo/e2ee-auth/web';

export type FolderResponse = KekAsymmetricDekEncryptedPayload & {
  createdAt: string;
  id: string;
  updatedAt: string;
};

export type SaveFolderPayload = {
  encryptedDeks: Array<KekAsymmetricDekEncryptedPayload['encryptedDek'] & { userId: string }>;
  encryptedPayload: KekAsymmetricDekEncryptedPayload['encryptedPayload'];
};

export async function fetchFolders({ baseUrl, token }: { baseUrl: string; token: string }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/folders`, { headers: { Authorization: `Bearer ${token}` } });
  return readFolderResponse<FolderResponse[]>(response, 'folders');
}

export async function saveFolder({ baseUrl, folderId, payload, token }: { baseUrl: string; folderId?: string; payload: SaveFolderPayload; token: string }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/folders${folderId ? `/${encodeURIComponent(folderId)}` : ''}`, {
    body: JSON.stringify(payload),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    method: folderId ? 'PUT' : 'POST',
  });
  return readFolderResponse<FolderResponse>(response, 'folder');
}

export async function deleteFolder({ baseUrl, folderId, token }: { baseUrl: string; folderId: string; token: string }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/folders/${encodeURIComponent(folderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    method: 'DELETE',
  });
  await readFolderResponse<boolean>(response, 'folder deletion');
}

function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('Set API_BASE_URL before syncing folders.');
  return normalized;
}

async function readFolderResponse<T>(response: Response, label: string): Promise<T> {
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'The backend rejected the folder request.');
  if (!body) throw new TypeError(`The backend returned an invalid ${label} payload.`);
  return body as T;
}
