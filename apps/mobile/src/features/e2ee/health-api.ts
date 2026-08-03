import type { PrincipalKind } from '../auth/auth-api';

export type HealthLinkedPrincipal = {
  email?: string | null;
  id: string;
  kind: PrincipalKind;
  username?: string | null;
};

export type ResourceKind = 'card' | 'folder';

export type ResourceHealth = {
  missingPrincipalIds: string[];
  recipientPrincipalIds: string[];
  resourceId: string;
  resourceKind: ResourceKind;
  updatedAt: string;
};

export type E2eeHealthResponse = {
  linkedPrincipals: HealthLinkedPrincipal[];
  resources: ResourceHealth[];
};

export type DeletionSummary = {
  deletedCards: number;
  deletedFolders: number;
};

export async function fetchE2eeHealth({ baseUrl, token }: { baseUrl: string; token: string }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/e2ee/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return readHealthResponse(response);
}

export async function deleteOrphanedResources({ baseUrl, token }: { baseUrl: string; token: string }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/e2ee/health/orphaned-resources`, {
    headers: { Authorization: `Bearer ${token}` },
    method: 'DELETE',
  });

  return readDeletionSummaryResponse(response);
}

export async function deleteUnrepairableResources({ baseUrl, token }: { baseUrl: string; token: string }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/e2ee/health/unrepairable-resources`, {
    headers: { Authorization: `Bearer ${token}` },
    method: 'DELETE',
  });

  return readDeletionSummaryResponse(response);
}

async function readDeletionSummaryResponse(response: Response): Promise<DeletionSummary> {
  const body = (await response.json().catch(() => null)) as
    | DeletionSummary
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'The backend rejected the deletion request.',
    );
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('deletedCards' in body) ||
    !('deletedFolders' in body)
  ) {
    throw new TypeError('The backend did not return a deletion summary.');
  }

  return body as DeletionSummary;
}

async function readHealthResponse(response: Response): Promise<E2eeHealthResponse> {
  const body = (await response.json().catch(() => null)) as
    | E2eeHealthResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'The backend rejected the e2ee health request.',
    );
  }

  if (!isE2eeHealthResponse(body)) {
    throw new TypeError('The backend did not return e2ee health data.');
  }

  return body;
}

function isE2eeHealthResponse(value: unknown): value is E2eeHealthResponse {
  return !!value &&
    typeof value === 'object' &&
    'linkedPrincipals' in value &&
    'resources' in value &&
    Array.isArray((value as E2eeHealthResponse).linkedPrincipals) &&
    Array.isArray((value as E2eeHealthResponse).resources);
}

function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, '');

  if (!normalized) {
    throw new Error('Enter the backend URL before checking e2ee health.');
  }

  return normalized;
}
