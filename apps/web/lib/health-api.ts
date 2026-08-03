import type { PrincipalKind } from '@/lib/auth-api';

export type AuthenticatedHealthApiRequest = {
  baseUrl: string;
  token: string;
};

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

export async function fetchE2eeHealth(request: AuthenticatedHealthApiRequest) {
  const response = await fetch(buildApiUrl(request.baseUrl, '/api/e2ee/health'), {
    headers: {
      Authorization: `Bearer ${request.token}`,
    },
    method: 'GET',
  });

  const responseBody = (await response.json().catch(() => null)) as
    | E2eeHealthResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    throw withResponseStatus(new Error(readErrorMessage(responseBody)), response.status);
  }

  if (!isE2eeHealthResponse(responseBody)) {
    throw new Error('The backend did not return e2ee health data.');
  }

  return responseBody;
}

export async function deleteOrphanedResources(request: AuthenticatedHealthApiRequest) {
  const response = await fetch(buildApiUrl(request.baseUrl, '/api/e2ee/health/orphaned-resources'), {
    headers: {
      Authorization: `Bearer ${request.token}`,
    },
    method: 'DELETE',
  });

  return readDeletionSummaryResponse(response);
}

export async function deleteUnrepairableResources(request: AuthenticatedHealthApiRequest) {
  const response = await fetch(
    buildApiUrl(request.baseUrl, '/api/e2ee/health/unrepairable-resources'),
    {
      headers: {
        Authorization: `Bearer ${request.token}`,
      },
      method: 'DELETE',
    },
  );

  return readDeletionSummaryResponse(response);
}

async function readDeletionSummaryResponse(response: Response): Promise<DeletionSummary> {
  const responseBody = (await response.json().catch(() => null)) as
    | DeletionSummary
    | { error?: string }
    | null;

  if (!response.ok) {
    throw withResponseStatus(new Error(readErrorMessage(responseBody as { error?: string } | null)), response.status);
  }

  if (
    !responseBody ||
    typeof responseBody !== 'object' ||
    !('deletedCards' in responseBody) ||
    !('deletedFolders' in responseBody)
  ) {
    throw new Error('The backend did not return a deletion summary.');
  }

  return responseBody as DeletionSummary;
}

function isE2eeHealthResponse(value: unknown): value is E2eeHealthResponse {
  return !!value &&
    typeof value === 'object' &&
    'linkedPrincipals' in value &&
    'resources' in value &&
    Array.isArray(value.linkedPrincipals) &&
    Array.isArray(value.resources);
}

function readErrorMessage(responseBody: E2eeHealthResponse | { error?: string } | null) {
  return responseBody && 'error' in responseBody && typeof responseBody.error === 'string'
    ? responseBody.error
    : 'The backend rejected the request.';
}

function buildApiUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');

  if (!normalizedBaseUrl) {
    throw new Error('Set API_BASE_URL for the web app before logging in.');
  }

  return `${normalizedBaseUrl}${path}`;
}

function withResponseStatus(error: Error, status: number) {
  return Object.assign(error, { status });
}
