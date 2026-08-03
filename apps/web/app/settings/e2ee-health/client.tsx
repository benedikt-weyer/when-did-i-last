'use client';

import { useEffect, useState } from 'react';

import { decryptStringWithAsymmetricKek, encryptStringWithAsymmetricKeks } from '@repo/e2ee-auth/web';

import { Button } from '@/components/ui/button';
import { fetchLinkedPrincipals } from '@/lib/auth-api';
import { fetchFolders, saveFolder } from '@/lib/folder-api';
import {
  fetchE2eeHealth,
  type E2eeHealthResponse,
  type HealthLinkedPrincipal,
  type ResourceHealth,
} from '@/lib/health-api';
import { deserializeNoteDocument, serializeNoteDocument } from '@/lib/offline-notes';
import { fetchNotes, updateNote } from '@/lib/test-note-api';

import {
  PageShell,
  SignedOutForm,
  StatusPanel,
  panelClassName,
  sectionClassName,
  useSessionPageState,
} from '../../shared/session-page';
import { formatTimestamp } from '../../shared/session-page-helpers';

export function E2eeHealthPageClient() {
  const [health, setHealth] = useState<E2eeHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);

  const shared = useSessionPageState();
  const {
    backendUrl,
    isHydrated,
    linkedKeks,
    runWithSessionRetry,
    session,
    setErrorMessage,
    setStatusMessage,
  } = shared;

  useEffect(() => {
    if (!isHydrated || !session) {
      return;
    }

    let isCancelled = false;
    const currentSession = session;
    const trimmedBackendUrl = backendUrl.trim();

    queueMicrotask(() => {
      if (isCancelled) {
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      runWithSessionRetry(currentSession, trimmedBackendUrl, (activeSession) =>
        fetchE2eeHealth({ baseUrl: trimmedBackendUrl, token: activeSession.token }),
      )
        .then((response) => {
          if (isCancelled) {
            return;
          }

          setHealth(response);
          setStatusMessage(buildHealthSummaryMessage(response));
        })
        .catch((error) => {
          if (isCancelled) {
            return;
          }

          setErrorMessage(
            error instanceof Error ? error.message : 'Unable to load the e2ee health report.',
          );
        })
        .finally(() => {
          if (!isCancelled) {
            setIsLoading(false);
          }
        });
    });

    return () => {
      isCancelled = true;
    };
  }, [backendUrl, isHydrated, runWithSessionRetry, session, setErrorMessage, setStatusMessage]);

  async function handleRepairAll() {
    if (!session || unhealthyResources.length === 0) {
      return;
    }

    const currentSession = session;
    const trimmedBackendUrl = backendUrl.trim();

    setIsRepairing(true);
    setErrorMessage(null);

    try {
      const linkedPrincipals = await runWithSessionRetry(currentSession, trimmedBackendUrl, (activeSession) =>
        fetchLinkedPrincipals({ baseUrl: trimmedBackendUrl, token: activeSession.token }),
      );
      const [remoteNotes, remoteFolders] = await Promise.all([
        runWithSessionRetry(currentSession, trimmedBackendUrl, (activeSession) =>
          fetchNotes({ baseUrl: trimmedBackendUrl, token: activeSession.token }),
        ),
        runWithSessionRetry(currentSession, trimmedBackendUrl, (activeSession) =>
          fetchFolders({ baseUrl: trimmedBackendUrl, token: activeSession.token }),
        ),
      ]);
      const notesById = new Map(remoteNotes.map((note) => [note.id, note]));
      const foldersById = new Map(remoteFolders.map((folder) => [folder.id, folder]));

      let repairedCount = 0;
      let failedCount = 0;

      for (const resource of unhealthyResources) {
        try {
          if (resource.resourceKind === 'card') {
            const note = notesById.get(resource.resourceId);

            if (!note) {
              throw new Error('The card no longer exists.');
            }

            const kek = linkedKeks.find((entry) => entry.kekPublicKey === note.encryptedDek.kekPublicKey);

            if (!kek) {
              throw new Error('Missing the local key for this card.');
            }

            const decryptedDocument = deserializeNoteDocument(
              await decryptStringWithAsymmetricKek(note, kek.cryptKey),
            );
            const encrypted = await encryptStringWithAsymmetricKeks(
              serializeNoteDocument(decryptedDocument),
              linkedPrincipals.map((principal) => principal.latestKekPublicKey),
            );

            await runWithSessionRetry(currentSession, trimmedBackendUrl, (activeSession) =>
              updateNote({
                baseUrl: trimmedBackendUrl,
                noteId: note.id,
                payload: {
                  encryptedDeks: encrypted.encryptedDeks.map((encryptedDek, index) => ({
                    ...encryptedDek,
                    userId: linkedPrincipals[index]!.id,
                  })),
                  encryptedPayload: encrypted.encryptedPayload,
                },
                token: activeSession.token,
              }),
            );
          } else {
            const folder = foldersById.get(resource.resourceId);

            if (!folder) {
              throw new Error('The folder no longer exists.');
            }

            const kek = linkedKeks.find((entry) => entry.kekPublicKey === folder.encryptedDek.kekPublicKey);

            if (!kek) {
              throw new Error('Missing the local key for this folder.');
            }

            const document = parseFolderDocument(
              await decryptStringWithAsymmetricKek(folder, kek.cryptKey),
            );
            const encrypted = await encryptStringWithAsymmetricKeks(
              JSON.stringify({ name: document.name, parentFolderId: document.parentFolderId, version: 1 }),
              linkedPrincipals.map((principal) => principal.latestKekPublicKey),
            );

            await runWithSessionRetry(currentSession, trimmedBackendUrl, (activeSession) =>
              saveFolder({
                baseUrl: trimmedBackendUrl,
                folderId: folder.id,
                payload: {
                  encryptedDeks: encrypted.encryptedDeks.map((encryptedDek, index) => ({
                    ...encryptedDek,
                    userId: linkedPrincipals[index]!.id,
                  })),
                  encryptedPayload: encrypted.encryptedPayload,
                },
                token: activeSession.token,
              }),
            );
          }

          repairedCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      const refreshedHealth = await runWithSessionRetry(currentSession, trimmedBackendUrl, (activeSession) =>
        fetchE2eeHealth({ baseUrl: trimmedBackendUrl, token: activeSession.token }),
      );

      setHealth(refreshedHealth);
      setStatusMessage(buildRepairSummaryMessage(repairedCount, failedCount));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to repair the unhealthy resources.',
      );
    } finally {
      setIsRepairing(false);
    }
  }

  const unhealthyResources = health?.resources.filter(
    (resource) => resource.missingPrincipalIds.length > 0,
  ) ?? [];
  const healthyCount = (health?.resources.length ?? 0) - unhealthyResources.length;

  return (
    <PageShell title="E2EE health">
      {shared.session ? (
        <div className="grid gap-4">
          <div className={panelClassName}>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Wrapped DEK coverage
            </p>
            <div className={sectionClassName}>
              <p className="text-base font-semibold text-foreground">
                {isLoading
                  ? 'Checking cards and folders...'
                  : `${healthyCount} healthy / ${unhealthyResources.length} unhealthy`}
              </p>
              <p className="text-sm leading-6 text-foreground/72">
                A card or folder is unhealthy when a currently-linked account or API user is
                missing a wrapped decryption key for it, usually because it was saved from a
                device before that principal was linked. Repairing re-encrypts each unhealthy
                item for every currently-linked account and API user.
              </p>
            </div>
          </div>

          {unhealthyResources.length > 0 && health ? (
            <div className={panelClassName}>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Unhealthy resources
              </p>
              <div className="grid gap-3">
                {unhealthyResources.map((resource) => (
                  <UnhealthyResourceRow
                    key={resource.resourceId}
                    linkedPrincipals={health.linkedPrincipals}
                    resource={resource}
                  />
                ))}
              </div>
              <Button
                disabled={isRepairing}
                onClick={() => {
                  void handleRepairAll();
                }}
                size="lg"
              >
                {isRepairing ? 'Repairing...' : `Repair ${unhealthyResources.length} unhealthy resource${unhealthyResources.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          ) : null}

          {shared.errorMessage ? (
            <p className="rounded-[1.2rem] bg-rose-100 px-4 py-3 text-sm font-medium text-rose-700">
              {shared.errorMessage}
            </p>
          ) : null}

          <StatusPanel statusMessage={shared.statusMessage} />
        </div>
      ) : (
        <div className={panelClassName} id="auth">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Authenticate
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              Log in to check e2ee health
            </h2>
          </div>
          <SignedOutForm
            email={shared.email}
            errorMessage={shared.errorMessage}
            isHydrated={shared.isHydrated}
            isSubmitting={shared.isSubmitting}
            mode={shared.mode}
            olderPasswords={shared.olderPasswords}
            onSubmit={() => {
              shared.handleSubmit().catch(() => {
                // The shared form surfaces submit failures through state.
              });
            }}
            password={shared.password}
            requiredOlderKeks={shared.requiredOlderKeks}
            setEmail={shared.setEmail}
            setMode={shared.setMode}
            setOlderPasswords={shared.setOlderPasswords}
            setPassword={shared.setPassword}
          />
        </div>
      )}
    </PageShell>
  );
}

function UnhealthyResourceRow({
  linkedPrincipals,
  resource,
}: Readonly<{
  linkedPrincipals: HealthLinkedPrincipal[];
  resource: ResourceHealth;
}>) {
  const missingPrincipals = resource.missingPrincipalIds.map((principalId) =>
    describePrincipal(linkedPrincipals, principalId),
  );

  return (
    <div className={sectionClassName}>
      <p className="text-sm font-semibold text-foreground">
        {resource.resourceKind === 'card' ? 'Card' : 'Folder'}{' '}
        <span className="font-mono text-xs text-foreground/60">{resource.resourceId}</span>
      </p>
      <p className="text-xs text-foreground/60">
        Last updated {formatTimestamp(resource.updatedAt)}
      </p>
      <p className="text-sm text-foreground/75">
        Missing wrapped DEK for: {missingPrincipals.join(', ')}
      </p>
    </div>
  );
}

function describePrincipal(linkedPrincipals: HealthLinkedPrincipal[], principalId: string) {
  const principal = linkedPrincipals.find((candidate) => candidate.id === principalId);

  if (!principal) {
    return principalId;
  }

  const label = principal.email ?? principal.username ?? principal.id;
  const kindLabel = principal.kind === 'api_user' ? 'API user' : 'account';

  return `${label} (${kindLabel})`;
}

function buildHealthSummaryMessage(health: E2eeHealthResponse) {
  const unhealthyCount = health.resources.filter(
    (resource) => resource.missingPrincipalIds.length > 0,
  ).length;

  if (unhealthyCount === 0) {
    return `All ${health.resources.length} cards and folders have wrapped keys for every linked account.`;
  }

  return `${unhealthyCount} of ${health.resources.length} cards and folders are missing a wrapped key for a linked account.`;
}

function buildRepairSummaryMessage(repairedCount: number, failedCount: number) {
  if (repairedCount === 0 && failedCount === 0) {
    return 'No resources needed repair.';
  }

  const segments = [];

  if (repairedCount > 0) {
    segments.push(`repaired ${repairedCount}`);
  }

  if (failedCount > 0) {
    segments.push(`failed to repair ${failedCount}`);
  }

  return `Repair complete: ${segments.join(', ')}.`;
}

function parseFolderDocument(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<{ name: unknown; parentFolderId: unknown; version: unknown }>;

    if (parsed.version === 1 && typeof parsed.name === 'string') {
      return {
        name: parsed.name,
        parentFolderId: typeof parsed.parentFolderId === 'string' && parsed.parentFolderId.trim() ? parsed.parentFolderId : null,
      };
    }
  } catch {
    // The folder payload is authenticated before this fallback is used.
  }

  throw new Error('The backend returned an invalid encrypted folder.');
}
