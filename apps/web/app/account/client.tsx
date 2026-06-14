'use client';

import { startTransition, useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

import {
  createApiToken,
  deriveApiTokenCredentials,
  deriveCredentials,
  deriveKekKeyPair,
  encryptStringWithAsymmetricKeks,
  rewrapAsymmetricEncryptedDek,
} from '@repo/e2ee-auth/web';

import { Button } from '@/components/ui/button';
import {
  createApiUserRequest,
  deleteAccountRequest,
  deleteApiUserRequest,
  fetchApiUser,
  fetchApiUsers,
  fetchKekMigrationStatus,
  fetchLinkedPrincipals,
  provisionApiUserDeksRequest,
  rotatePasswordRequest,
  type ApiUserResponse,
  type KekMigrationStatusResponse,
} from '@/lib/auth-api';
import { localStorageAuthPersistence } from '@/lib/auth-storage';
import { fetchNotes, updateNote } from '@/lib/test-note-api';

import {
  PageShell,
  LabeledInput,
  SignedOutForm,
  StatusPanel,
  panelClassName,
  sectionClassName,
  useSessionPageState,
} from '../shared/session-page';
import { syncOfflineNotes } from '../shared/offline-note-sync';
import {
  buildKekMigrationMessage,
  decryptApiUserRecord,
  deriveMissingLinkedKeks,
  findLinkedKek,
  formatTimestamp,
  requireLinkedKek,
  sortKekMetadatas,
  type ApiUserView,
  type MigrationProgress,
} from '../shared/session-page-helpers';

type ApiUserProvisionProgress = MigrationProgress & {
  apiUserId: string;
  username: string;
};

export function AccountPageClient() {
  const shared = useSessionPageState();
  const {
    backendUrl,
    isHydrated,
    linkedKeks,
    runWithSessionRetry,
    session,
    setLinkedKeks,
    setStatusMessage,
  } = shared;
  type LinkedKeks = typeof linkedKeks;
  type ActiveSession = NonNullable<typeof session>;
  const [nextPassword, setNextPassword] = useState('');
  const [apiUserLabel, setApiUserLabel] = useState('');
  const [apiUsers, setApiUsers] = useState<ApiUserView[]>([]);
  const [latestApiToken, setLatestApiToken] = useState<string | null>(null);
  const [migrationPasswords, setMigrationPasswords] = useState<Record<string, string>>({});
  const [kekMigrationStatus, setKekMigrationStatus] =
    useState<KekMigrationStatusResponse | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [apiUserProgress, setApiUserProgress] = useState<ApiUserProvisionProgress | null>(null);
  const [isCreatingApiUser, setIsCreatingApiUser] = useState(false);
  const [deletingApiUserId, setDeletingApiUserId] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isRotatingPassword, setIsRotatingPassword] = useState(false);

  const loadApiUsers = useCallback(
    async ({
      linkedKeks,
      nextSession,
      trimmedBackendUrl,
    }: {
      linkedKeks: LinkedKeks;
      nextSession: ActiveSession;
      trimmedBackendUrl: string;
    }) => {
      try {
        const remoteApiUsers = await runWithSessionRetry(
          nextSession,
          trimmedBackendUrl,
          (activeSession) =>
            fetchApiUsers({
              baseUrl: trimmedBackendUrl,
              token: activeSession.token,
            }),
        );
        const decryptedApiUsers = await Promise.all(
          remoteApiUsers.map((apiUser) => decryptApiUserRecord(apiUser, linkedKeks)),
        );

        setApiUsers(decryptedApiUsers);
      } catch {
        setApiUsers([]);
      }
    },
    [runWithSessionRetry],
  );

  const refreshKekMigrationStatus = useCallback(
    async (nextSession: ActiveSession, trimmedBackendUrl: string) => {
      const nextStatus = await runWithSessionRetry(
        nextSession,
        trimmedBackendUrl,
        (activeSession) =>
          fetchKekMigrationStatus({
            baseUrl: trimmedBackendUrl,
            token: activeSession.token,
          }),
      );

      setKekMigrationStatus(nextStatus);

      return nextStatus;
    },
    [runWithSessionRetry],
  );

  useEffect(() => {
    if (!isHydrated || !session || linkedKeks.length === 0) {
      startTransition(() => {
        setApiUsers([]);
        setKekMigrationStatus(null);
      });
      return;
    }

    if (session.currentPrincipal.kind !== 'user') {
      startTransition(() => {
        setApiUsers([]);
        setKekMigrationStatus(null);
      });
      return;
    }

    let isCancelled = false;
    const currentSession = session;
    const trimmedBackendUrl = backendUrl.trim();

    queueMicrotask(() => {
      void loadApiUsers({
        linkedKeks,
        nextSession: currentSession,
        trimmedBackendUrl,
      }).then(() => {
        if (!isCancelled) {
          void refreshKekMigrationStatus(currentSession, trimmedBackendUrl).catch(() => {
            setKekMigrationStatus(null);
          });
        }
      }).catch(() => {
        if (!isCancelled) {
          setApiUsers([]);
        }
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [backendUrl, isHydrated, linkedKeks, loadApiUsers, refreshKekMigrationStatus, session]);

  const continueKekMigration = useCallback(async ({
    linkedKeks: baseLinkedKeks,
    nextSession,
  }: {
    linkedKeks: LinkedKeks;
    nextSession: ActiveSession;
  }) => {
    const latestKekMetadata = sortKekMetadatas(nextSession.kekMetadatas)[0];

    if (!latestKekMetadata) {
      throw new Error('The backend did not return KEK metadata.');
    }

    const workingLinkedKeks = await deriveMissingLinkedKeks({
      baseLinkedKeks,
      email: nextSession.user.email,
      missingMetadatas: nextSession.kekMetadatas.filter(
        (metadata) => !findLinkedKek(baseLinkedKeks, metadata.kekPublicKey),
      ),
      passwordsByKekId: migrationPasswords,
    });
    const latestLinkedKek = requireLinkedKek(workingLinkedKeks, latestKekMetadata.kekPublicKey);
    const trimmedBackendUrl = backendUrl.trim();
    const currentLinkedPrincipals = await runWithSessionRetry(
      nextSession,
      trimmedBackendUrl,
      (activeSession) =>
        fetchLinkedPrincipals({
          baseUrl: trimmedBackendUrl,
          token: activeSession.token,
        }),
    );
    const remoteNotes = await runWithSessionRetry(
      nextSession,
      trimmedBackendUrl,
      (activeSession) =>
        fetchNotes({
          baseUrl: trimmedBackendUrl,
          token: activeSession.token,
        }),
    );
    const notesToRewrap = remoteNotes.filter(
      (note) => note.encryptedDek.kekPublicKey !== latestLinkedKek.kekPublicKey,
    );

    setIsMigrating(true);
    setMigrationProgress({
      completed: 0,
      total: notesToRewrap.length,
    });

    try {
      for (let index = 0; index < notesToRewrap.length; index += 1) {
        const note = notesToRewrap[index];
        const noteLinkedKek = findLinkedKek(workingLinkedKeks, note.encryptedDek.kekPublicKey);

        if (!noteLinkedKek) {
          throw new Error(
            `Missing the local KEK for epoch-linked id ${note.encryptedDek.kekPublicKey}. Provide the matching older password first.`,
          );
        }

        await runWithSessionRetry(nextSession, trimmedBackendUrl, async (activeSession) =>
          updateNote({
            baseUrl: trimmedBackendUrl,
            noteId: note.id,
            payload: {
              encryptedDeks: await Promise.all(
                currentLinkedPrincipals.map(async (principal) => ({
                  ...(await rewrapAsymmetricEncryptedDek(
                    note,
                    noteLinkedKek.cryptKey,
                    principal.latestKekPublicKey,
                  )),
                  userId: principal.id,
                })),
              ),
              encryptedPayload: note.encryptedPayload,
            },
            token: activeSession.token,
          }),
        );

        setMigrationProgress({
          completed: index + 1,
          total: notesToRewrap.length,
        });
      }

      setLinkedKeks(workingLinkedKeks);
      setMigrationPasswords({});
      localStorageAuthPersistence.writeDerivedCredentials({
        email: nextSession.user.email,
        linkedKeks: workingLinkedKeks,
      });

      const finalStatus = await refreshKekMigrationStatus(nextSession, trimmedBackendUrl);

      if (!finalStatus.allDeksUseLatestKek) {
        throw new Error('The backend still reports DEKs on older KEK epochs after migration.');
      }

      await syncOfflineNotes({
        linkedKeks: workingLinkedKeks,
        nextSession,
        runWithSessionRetry,
        trimmedBackendUrl,
      });
      setStatusMessage(
        notesToRewrap.length === 0
          ? 'All DEKs already use the latest KEK epoch.'
          : buildKekMigrationMessage(notesToRewrap.length, latestKekMetadata.kekEpochVersion),
      );
    } finally {
      setIsMigrating(false);
      setMigrationProgress(null);
    }
  }, [
    backendUrl,
    migrationPasswords,
    refreshKekMigrationStatus,
    runWithSessionRetry,
    setLinkedKeks,
    setStatusMessage,
  ]);

  async function handleRotatePassword() {
    if (!shared.session) {
      return;
    }

    shared.setErrorMessage(null);
    setIsRotatingPassword(true);

    try {
      const trimmedBackendUrl = shared.backendUrl.trim();
      const saltHex = shared.linkedKeks[0]?.saltHex;

      if (!saltHex) {
        throw new Error('The current password salt is missing from local storage. Log in again.');
      }

      const credentials = await deriveCredentials(shared.session.user.email, nextPassword, saltHex);
      const kekKeyPair = await deriveKekKeyPair(credentials.cryptKey);
      const response = await shared.runWithSessionRetry(shared.session, trimmedBackendUrl, (activeSession) =>
        rotatePasswordRequest({
          baseUrl: trimmedBackendUrl,
          kekPublicKey: kekKeyPair.kekPublicKey,
          newAuthKey: credentials.authKey,
          token: activeSession.token,
        }),
      );
      const latestKekMetadata = sortKekMetadatas(response.kekMetadatas)[0];

      if (!latestKekMetadata) {
        throw new Error('The backend did not return KEK metadata.');
      }

      const nextLinkedKeks = [
        ...shared.linkedKeks,
        {
          cryptKey: credentials.cryptKey,
          kekEpochVersion: latestKekMetadata.kekEpochVersion,
          kekPublicKey: latestKekMetadata.kekPublicKey,
          saltHex,
        },
      ];

      shared.persistAuthSession(response);
      shared.setLinkedKeks(nextLinkedKeks);
      setNextPassword('');
      localStorageAuthPersistence.writeDerivedCredentials({
        email: shared.session.user.email,
        linkedKeks: nextLinkedKeks,
      });
      await continueKekMigration({
        linkedKeks: nextLinkedKeks,
        nextSession: response,
      });
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to rotate the password.',
      );
    } finally {
      setIsRotatingPassword(false);
    }
  }

  async function handleContinueMigration() {
    if (!shared.session) {
      return;
    }

    shared.setErrorMessage(null);

    try {
      await continueKekMigration({
        linkedKeks: shared.linkedKeks,
        nextSession: shared.session,
      });
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to continue the KEK migration.',
      );
    }
  }

  async function continueApiUserProvisioning(
    apiUser: ApiUserResponse,
    {
      linkedKeks,
      nextSession,
    }: {
      linkedKeks: typeof shared.linkedKeks;
      nextSession: NonNullable<typeof shared.session>;
    },
  ) {
    const trimmedBackendUrl = shared.backendUrl.trim();
    const remoteNotes = await shared.runWithSessionRetry(nextSession, trimmedBackendUrl, (activeSession) =>
      fetchNotes({
        baseUrl: trimmedBackendUrl,
        token: activeSession.token,
      }),
    );
    const notesById = new Map(remoteNotes.map((note) => [note.id, note]));

    setApiUserProgress({
      apiUserId: apiUser.id,
      completed: apiUser.provisioning.completedResourceCount,
      total: apiUser.provisioning.totalResourceCount,
      username: apiUser.username,
    });

    let latestApiUser = apiUser;

    try {
      for (let index = 0; index < apiUser.provisioning.pendingNoteIds.length; index += 1) {
        const noteId = apiUser.provisioning.pendingNoteIds[index]!;
        const note = notesById.get(noteId);

        if (!note) {
          throw new Error('A note required for api user provisioning is missing from the backend.');
        }

        const noteLinkedKek = findLinkedKek(linkedKeks, note.encryptedDek.kekPublicKey);

        if (!noteLinkedKek) {
          throw new Error(
            `Missing the local KEK for epoch-linked id ${note.encryptedDek.kekPublicKey}. Log in again and provide the older password for that KEK.`,
          );
        }

        latestApiUser = await shared.runWithSessionRetry(nextSession, trimmedBackendUrl, async (activeSession) =>
          provisionApiUserDeksRequest({
            apiUserId: apiUser.id,
            baseUrl: trimmedBackendUrl,
            token: activeSession.token,
            wrappedDeks: [
              {
                resourceId: note.id,
                wrappedDek: {
                  ...(await rewrapAsymmetricEncryptedDek(
                    note,
                    noteLinkedKek.cryptKey,
                    latestApiUser.latestKekPublicKey,
                  )),
                  userId: latestApiUser.id,
                },
              },
            ],
          }),
        );

        setApiUserProgress({
          apiUserId: latestApiUser.id,
          completed: latestApiUser.provisioning.completedResourceCount,
          total: latestApiUser.provisioning.totalResourceCount,
          username: latestApiUser.username,
        });
      }

      await loadApiUsers({
        linkedKeks,
        nextSession,
        trimmedBackendUrl,
      });
      shared.setStatusMessage(
        latestApiUser.provisioning.pendingResourceCount === 0
          ? `Provisioned api user ${latestApiUser.username}.`
          : `Provisioning for api user ${latestApiUser.username} is still pending.`,
      );
    } finally {
      setApiUserProgress(null);
    }
  }

  async function handleCreateApiUser() {
    if (!shared.session || shared.session.currentPrincipal.kind !== 'user') {
      return;
    }

    shared.setErrorMessage(null);
    setIsCreatingApiUser(true);

    try {
      const trimmedBackendUrl = shared.backendUrl.trim();
      const currentLinkedPrincipals = await shared.runWithSessionRetry(shared.session, trimmedBackendUrl, (activeSession) =>
        fetchLinkedPrincipals({
          baseUrl: trimmedBackendUrl,
          token: activeSession.token,
        }),
      );
      const ownerPrincipal = currentLinkedPrincipals.find((principal) => principal.id === shared.session!.user.id);

      if (!ownerPrincipal) {
        throw new Error('The backend did not return the owner KEK metadata.');
      }

      const apiUserId = crypto.randomUUID();
      const apiToken = await createApiToken();
      const apiTokenCredentials = await deriveApiTokenCredentials(apiToken);
      const encryptedLabel = await encryptStringWithAsymmetricKeks(apiUserLabel, [
        ownerPrincipal.latestKekPublicKey,
        apiTokenCredentials.kekKeyPair.kekPublicKey,
      ]);
      const createdApiUser = await shared.runWithSessionRetry(shared.session, trimmedBackendUrl, (activeSession) =>
        createApiUserRequest({
          authKey: apiTokenCredentials.authKey,
          baseUrl: trimmedBackendUrl,
          encryptedLabel: encryptedLabel.encryptedPayload,
          encryptedLabelDeks: encryptedLabel.encryptedDeks.map((encryptedDek, index) => ({
            ...encryptedDek,
            userId: index === 0 ? ownerPrincipal.id : apiUserId,
          })),
          id: apiUserId,
          kekPublicKey: apiTokenCredentials.kekKeyPair.kekPublicKey,
          token: activeSession.token,
        }),
      );

      setLatestApiToken(apiToken);
      setApiUserLabel('');
      await continueApiUserProvisioning(createdApiUser, {
        linkedKeks: shared.linkedKeks,
        nextSession: shared.session,
      });
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to create the api user.',
      );
    } finally {
      setIsCreatingApiUser(false);
    }
  }

  async function handleResumeApiUser(apiUserId: string) {
    if (!shared.session || shared.session.currentPrincipal.kind !== 'user') {
      return;
    }

    shared.setErrorMessage(null);

    try {
      const apiUser = await shared.runWithSessionRetry(shared.session, shared.backendUrl.trim(), (activeSession) =>
        fetchApiUser({
          apiUserId,
          baseUrl: shared.backendUrl.trim(),
          token: activeSession.token,
        }),
      );

      await continueApiUserProvisioning(apiUser, {
        linkedKeks: shared.linkedKeks,
        nextSession: shared.session,
      });
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to resume api user provisioning.',
      );
    }
  }

  async function handleDeleteApiUser(apiUser: ApiUserView) {
    if (!shared.session || shared.session.currentPrincipal.kind !== 'user') {
      return;
    }

    const confirmed = globalThis.confirm(
      `Remove api user ${apiUser.username}? This also deletes its linked KEK and DEK entries.`,
    );

    if (!confirmed) {
      return;
    }

    shared.setErrorMessage(null);
    setDeletingApiUserId(apiUser.id);

    try {
      await shared.runWithSessionRetry(shared.session, shared.backendUrl.trim(), (activeSession) =>
        deleteApiUserRequest({
          apiUserId: apiUser.id,
          baseUrl: shared.backendUrl.trim(),
          token: activeSession.token,
        }),
      );

      setApiUsers((currentApiUsers) => currentApiUsers.filter((entry) => entry.id !== apiUser.id));
      shared.setStatusMessage(`Removed api user ${apiUser.username} and its linked key material.`);
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to delete the api user.',
      );
    } finally {
      setDeletingApiUserId(null);
    }
  }

  async function handleDeleteAccount() {
    if (!shared.session || shared.session.currentPrincipal.kind !== 'user') {
      return;
    }

    const confirmed = globalThis.confirm(
      `Delete account ${shared.session.user.email}? This removes the user, linked api users, notes, DEKs, KEKs, and stored encrypted data.`,
    );

    if (!confirmed) {
      return;
    }

    shared.setErrorMessage(null);
    setIsDeletingAccount(true);

    try {
      await shared.runWithSessionRetry(shared.session, shared.backendUrl.trim(), (activeSession) =>
        deleteAccountRequest({
          baseUrl: shared.backendUrl.trim(),
          token: activeSession.token,
        }),
      );

      shared.clearSessionState({ clearDerivedCredentials: true });
      shared.setStatusMessage('Deleted the account and cleared the local linked key material.');
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to delete the account.',
      );
    } finally {
      setIsDeletingAccount(false);
    }
  }

  const isOwnerSession = shared.session?.currentPrincipal.kind === 'user';
  const missingMigrationKeks = shared.session
    ? shared.session.kekMetadatas.filter(
        (metadata) => !findLinkedKek(shared.linkedKeks, metadata.kekPublicKey),
      )
    : [];
  const needsMigration =
    !!shared.session &&
    !!kekMigrationStatus &&
    shared.session.kekMetadatas.length > 1 &&
    !kekMigrationStatus.allDeksUseLatestKek;

  return (
    <PageShell title="Account settings">
      <div className={panelClassName} id="auth">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              {shared.session ? 'Encrypted session' : 'Authenticate'}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              {shared.session ? `Signed in as ${shared.session.user.email}` : 'Login or register'}
            </h2>
          </div>
          {shared.session ? (
            <Button onClick={() => shared.handleSignOut()} variant="outline">
              Sign out
            </Button>
          ) : null}
        </div>

        {shared.session ? (
          <div className="grid gap-5">
            {shared.errorMessage ? (
              <p className="rounded-[1.2rem] bg-rose-100 px-4 py-3 text-sm font-medium text-rose-700">
                {shared.errorMessage}
              </p>
            ) : null}

            <div className={sectionClassName}>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Password rotation
              </p>
              <LabeledInput
                autoComplete="new-password"
                label="New password"
                onChange={setNextPassword}
                placeholder="Type the new password for the next KEK epoch"
                type="password"
                value={nextPassword}
              />
              <Button
                disabled={isRotatingPassword || isMigrating}
                onClick={() => {
                  void handleRotatePassword();
                }}
                size="lg"
              >
                {isRotatingPassword ? 'Rotating password...' : 'Rotate password and start migration'}
              </Button>
            </div>

            {needsMigration ? (
              <div className="grid gap-3 rounded-[1.4rem] border border-amber-200 bg-amber-50/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-900">
                    KEK migration
                  </p>
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-900/75">
                    {kekMigrationStatus?.pendingDekCount ?? 0} pending
                  </span>
                </div>
                {missingMigrationKeks.map((metadata) => (
                  <LabeledInput
                    autoComplete="current-password"
                    key={metadata.kekPublicKey}
                    label={`Missing password for epoch ${metadata.kekEpochVersion}`}
                    onChange={(value) =>
                      setMigrationPasswords((currentPasswords) => ({
                        ...currentPasswords,
                        [metadata.kekPublicKey]: value,
                      }))
                    }
                    placeholder="Type the password for this older KEK epoch"
                    type="password"
                    value={migrationPasswords[metadata.kekPublicKey] ?? ''}
                  />
                ))}
                {migrationProgress ? (
                  <div className="grid gap-2">
                    <div className="h-3 overflow-hidden rounded-full bg-amber-100">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-[width]"
                        style={{
                          width: `${migrationProgress.total === 0 ? 100 : (migrationProgress.completed / migrationProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                    <p className="text-sm text-amber-950/80">
                      Migrated {migrationProgress.completed} of {migrationProgress.total} DEKs.
                    </p>
                  </div>
                ) : null}
                {isMigrating ? null : (
                  <Button
                    onClick={() => {
                      void handleContinueMigration();
                    }}
                    size="lg"
                    variant="outline"
                  >
                    Continue migration
                  </Button>
                )}
              </div>
            ) : null}

            {isOwnerSession ? (
              <div className="grid gap-3 rounded-[1.4rem] border border-rose-200 bg-rose-50/80 p-4">
                <div className="flex items-center gap-3 text-rose-950">
                  <Trash2 className="size-5" />
                  <p className="text-sm font-semibold uppercase tracking-[0.22em] text-rose-900/80">
                    Delete account
                  </p>
                </div>
                <Button
                  className="border-rose-300 text-rose-950 hover:bg-rose-100"
                  disabled={isDeletingAccount || isMigrating || isRotatingPassword || !!apiUserProgress}
                  onClick={() => {
                    void handleDeleteAccount();
                  }}
                  size="lg"
                  variant="outline"
                >
                  {isDeletingAccount ? 'Deleting account...' : 'Delete account'}
                </Button>
              </div>
            ) : null}

            {isOwnerSession ? (
              <div className={sectionClassName}>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  API users
                </p>
                <LabeledInput
                  autoComplete="off"
                  label="API user label"
                  onChange={setApiUserLabel}
                  placeholder="CLI integration, automation, server agent"
                  type="text"
                  value={apiUserLabel}
                />
                <Button
                  disabled={isCreatingApiUser || isMigrating || !apiUserLabel.trim()}
                  onClick={() => {
                    void handleCreateApiUser();
                  }}
                  size="lg"
                  variant="outline"
                >
                  {isCreatingApiUser ? 'Creating api user...' : 'Create api user'}
                </Button>
                {latestApiToken ? (
                  <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
                    <p className="font-semibold">Latest api token</p>
                    <p className="mt-2 break-all font-mono text-xs">{latestApiToken}</p>
                  </div>
                ) : null}
                {apiUserProgress ? (
                  <div className="grid gap-2 rounded-[1.5rem] border border-sky-200 bg-sky-50 px-4 py-3">
                    <p className="text-sm font-semibold text-sky-950">
                      Provisioning {apiUserProgress.username}
                    </p>
                    <div className="h-3 overflow-hidden rounded-full bg-sky-100">
                      <div
                        className="h-full rounded-full bg-sky-500 transition-[width]"
                        style={{
                          width: `${apiUserProgress.total === 0 ? 100 : (apiUserProgress.completed / apiUserProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                    <p className="text-sm text-sky-950/80">
                      Provisioned {apiUserProgress.completed} of {apiUserProgress.total} resources.
                    </p>
                  </div>
                ) : null}
                <div className="grid gap-3">
                  {apiUsers.length === 0 ? (
                    <p className="text-sm text-foreground/60">No api users created yet.</p>
                  ) : (
                    apiUsers.map((apiUser) => (
                      <article className="grid gap-3 rounded-[1.2rem] border border-border/60 bg-card px-4 py-4" key={apiUser.id}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-foreground">{apiUser.label || 'Unlabeled api user'}</p>
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                              {apiUser.username}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              {apiUser.provisioning.completedResourceCount}/{apiUser.provisioning.totalResourceCount}
                            </span>
                            <Button
                              disabled={
                                deletingApiUserId === apiUser.id ||
                                !!apiUserProgress ||
                                isCreatingApiUser
                              }
                              onClick={() => {
                                void handleDeleteApiUser(apiUser);
                              }}
                              size="sm"
                              variant="ghost"
                            >
                              <Trash2 className="size-4" />
                              {deletingApiUserId === apiUser.id ? 'Removing...' : 'Remove'}
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/60">
                          <span>Created {formatTimestamp(apiUser.createdAt)}</span>
                          <span>Updated {formatTimestamp(apiUser.updatedAt)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-[width]"
                            style={{
                              width: `${apiUser.provisioning.totalResourceCount === 0 ? 100 : (apiUser.provisioning.completedResourceCount / apiUser.provisioning.totalResourceCount) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="text-sm text-foreground/70">
                          {apiUser.provisioning.pendingResourceCount === 0
                            ? 'Provisioning complete.'
                            : `${apiUser.provisioning.pendingResourceCount} resource wrap${apiUser.provisioning.pendingResourceCount === 1 ? '' : 's'} still pending.`}
                        </p>
                        {apiUser.provisioning.pendingResourceCount > 0 ? (
                          <Button
                            disabled={!!apiUserProgress || isCreatingApiUser || deletingApiUserId === apiUser.id}
                            onClick={() => {
                              void handleResumeApiUser(apiUser.id);
                            }}
                            size="sm"
                            variant="outline"
                          >
                            Resume provisioning
                          </Button>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            <StatusPanel statusMessage={shared.statusMessage} />
          </div>
        ) : (
          <SignedOutForm
            email={shared.email}
            errorMessage={shared.errorMessage}
            isHydrated={shared.isHydrated}
            isSubmitting={shared.isSubmitting}
            mode={shared.mode}
            olderPasswords={shared.olderPasswords}
            onSubmit={() => {
              void shared.handleSubmit();
            }}
            password={shared.password}
            requiredOlderKeks={shared.requiredOlderKeks}
            setEmail={shared.setEmail}
            setMode={shared.setMode}
            setOlderPasswords={shared.setOlderPasswords}
            setPassword={shared.setPassword}
          />
        )}
      </div>
    </PageShell>
  );
}