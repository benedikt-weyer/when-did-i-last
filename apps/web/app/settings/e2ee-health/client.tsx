'use client';

import { useEffect, useState } from 'react';

import {
  fetchE2eeHealth,
  type E2eeHealthResponse,
  type HealthLinkedPrincipal,
  type ResourceHealth,
} from '@/lib/health-api';

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

  const shared = useSessionPageState();
  const {
    backendUrl,
    isHydrated,
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
                missing a wrapped decryption key for it. This can only be detected here, not
                repaired &mdash; this page is read only.
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
