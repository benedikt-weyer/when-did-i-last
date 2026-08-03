import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { useAuth } from '../features/auth/auth-context';
import { fetchLinkedPrincipals } from '../features/auth/auth-api';
import { fetchFolders, saveFolder } from '../features/e2ee/folder-api';
import {
  deserializeNoteDocument,
  serializeNoteDocument,
} from '../features/e2ee/offline-notes';
import { fetchNotes, updateNote } from '../features/e2ee/test-note-api';
import { getNativeAuthModule } from '../features/e2ee/native-runtime';
import {
  deleteOrphanedResources,
  deleteUnrepairableResources,
  fetchE2eeHealth,
  type DeletionSummary,
  type E2eeHealthResponse,
  type HealthLinkedPrincipal,
  type ResourceHealth,
} from '../features/e2ee/health-api';
import { useAppTheme } from '../features/theme/theme-context';
import { themeTokens, type ThemeTokenSet } from '../theme/theme-tokens';

type FailedRepair = {
  message: string;
  resource: ResourceHealth;
};

export function E2eeHealthScreen() {
  const { activeKekId, backendUrl, linkedKeks, runWithFreshSession, session } = useAuth();
  const { themeMode } = useAppTheme();
  const router = useRouter();
  const tokens = themeTokens[themeMode];
  const isMountedRef = useRef(true);
  const [health, setHealth] = useState<E2eeHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [failedRepairs, setFailedRepairs] = useState<FailedRepair[]>([]);
  const [isDeletingOrphaned, setIsDeletingOrphaned] = useState(false);
  const [isDeletingUnrepairable, setIsDeletingUnrepairable] = useState(false);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadHealth = useCallback(async () => {
    if (!session) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await runWithFreshSession((activeSession) =>
        fetchE2eeHealth({ baseUrl: backendUrl, token: activeSession.token }),
      );

      if (!isMountedRef.current) {
        return;
      }

      setHealth(response);
      setStatusMessage(buildHealthSummaryMessage(response));
    } catch (error) {
      if (isMountedRef.current) {
        setStatusMessage(
          error instanceof Error ? error.message : 'Unable to load the e2ee health report.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [backendUrl, runWithFreshSession, session]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const unhealthyResources = health?.resources.filter(
    (resource) => resource.missingPrincipalIds.length > 0,
  ) ?? [];
  const healthyCount = (health?.resources.length ?? 0) - unhealthyResources.length;

  async function handleRepairAll() {
    if (!session || !activeKekId || unhealthyResources.length === 0) {
      return;
    }

    setIsRepairing(true);
    setFailedRepairs([]);

    try {
      const linkedPrincipals = await runWithFreshSession((activeSession) =>
        fetchLinkedPrincipals({ baseUrl: backendUrl, token: activeSession.token }),
      );
      const [remoteNotes, remoteFolders] = await Promise.all([
        runWithFreshSession((activeSession) =>
          fetchNotes({ baseUrl: backendUrl, token: activeSession.token }),
        ),
        runWithFreshSession((activeSession) =>
          fetchFolders({ baseUrl: backendUrl, token: activeSession.token }),
        ),
      ]);
      const notesById = new Map(remoteNotes.map((note) => [note.id, note]));
      const foldersById = new Map(remoteFolders.map((folder) => [folder.id, folder]));
      const { decryptStringWithAsymmetricKek, encryptStringWithAsymmetricKeks } =
        await getNativeAuthModule();

      let repairedCount = 0;
      const failedRepairsForRun: FailedRepair[] = [];

      for (const resource of unhealthyResources) {
        try {
          if (resource.resourceKind === 'card') {
            const note = notesById.get(resource.resourceId);

            if (!note) {
              throw new Error(
                'Your account has no wrapped key for this card, so it cannot be decrypted from here. Repair it from a device or account that already has access.',
              );
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

            await runWithFreshSession((activeSession) =>
              updateNote({
                baseUrl: backendUrl,
                noteId: note.id,
                payload: {
                  encryptedDeks: encrypted.encryptedDeks.map((encryptedDek, index) => {
                    const principal = linkedPrincipals[index];

                    if (!principal) {
                      throw new Error('The backend returned an incomplete linked principal list.');
                    }

                    return { ...encryptedDek, userId: principal.id };
                  }),
                  encryptedPayload: encrypted.encryptedPayload,
                },
                token: activeSession.token,
              }),
            );
          } else {
            const folder = foldersById.get(resource.resourceId);

            if (!folder) {
              throw new Error(
                'Your account has no wrapped key for this folder, so it cannot be decrypted from here. Repair it from a device or account that already has access.',
              );
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

            await runWithFreshSession((activeSession) =>
              saveFolder({
                baseUrl: backendUrl,
                folderId: folder.id,
                payload: {
                  encryptedDeks: encrypted.encryptedDeks.map((encryptedDek, index) => {
                    const principal = linkedPrincipals[index];

                    if (!principal) {
                      throw new Error('The backend returned an incomplete linked principal list.');
                    }

                    return { ...encryptedDek, userId: principal.id };
                  }),
                  encryptedPayload: encrypted.encryptedPayload,
                },
                token: activeSession.token,
              }),
            );
          }

          repairedCount += 1;
        } catch (error) {
          failedRepairsForRun.push({
            message: error instanceof Error ? error.message : 'Unable to repair this resource.',
            resource,
          });
        }
      }

      await loadHealth();

      if (isMountedRef.current) {
        setFailedRepairs(failedRepairsForRun);
        setStatusMessage(buildRepairSummaryMessage(repairedCount, failedRepairsForRun.length));
      }
    } catch (error) {
      if (isMountedRef.current) {
        setStatusMessage(
          error instanceof Error ? error.message : 'Unable to repair the unhealthy resources.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsRepairing(false);
      }
    }
  }

  async function handleDeleteOrphaned() {
    if (!session || orphanedResources.length === 0) {
      return;
    }

    const confirmed = await confirmDeletion(
      'Delete orphaned resources',
      `Permanently delete ${orphanedResources.length} orphaned resource${orphanedResources.length === 1 ? '' : 's'}? No linked account or API user has a key for them, so this cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingOrphaned(true);

    try {
      const summary = await runWithFreshSession((activeSession) =>
        deleteOrphanedResources({ baseUrl: backendUrl, token: activeSession.token }),
      );

      await loadHealth();

      if (isMountedRef.current) {
        setFailedRepairs([]);
        setStatusMessage(buildDeletionSummaryMessage(summary));
      }
    } catch (error) {
      if (isMountedRef.current) {
        setStatusMessage(
          error instanceof Error ? error.message : 'Unable to delete the orphaned resources.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsDeletingOrphaned(false);
      }
    }
  }

  async function handleDeleteUnrepairable() {
    if (!session || failedRepairs.length === 0) {
      return;
    }

    const confirmed = await confirmDeletion(
      'Delete unrepairable resources',
      `Permanently delete ${failedRepairs.length} unrepairable resource${failedRepairs.length === 1 ? '' : 's'}? Your account cannot decrypt them, even though another linked account or API user might still have access. This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingUnrepairable(true);

    try {
      const summary = await runWithFreshSession((activeSession) =>
        deleteUnrepairableResources({ baseUrl: backendUrl, token: activeSession.token }),
      );

      await loadHealth();

      if (isMountedRef.current) {
        setFailedRepairs([]);
        setStatusMessage(buildDeletionSummaryMessage(summary));
      }
    } catch (error) {
      if (isMountedRef.current) {
        setStatusMessage(
          error instanceof Error ? error.message : 'Unable to delete the unrepairable resources.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsDeletingUnrepairable(false);
      }
    }
  }

  const orphanedResources = unhealthyResources.filter(
    (resource) => resource.recipientPrincipalIds.length === 0,
  );

  return (
    <ScreenShell
      themeMode={themeMode}
      title="E2EE health"
    >
      <Pressable
        className="items-center rounded-full border border-stone-300 px-4 py-4 dark:border-slate-700"
        onPress={() => {
          router.replace('/settings');
        }}
      >
        <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.title}`}>
          Back to settings
        </Text>
      </Pressable>

      <View className="gap-3">
        <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
          Wrapped DEK coverage
        </Text>
        <Text className={`text-base font-semibold ${tokens.title}`}>
          {isLoading ? 'Checking cards and folders...' : `${healthyCount} healthy / ${unhealthyResources.length} unhealthy`}
        </Text>
        <Text className={`text-sm leading-6 ${tokens.body}`}>
          A card or folder is unhealthy when a currently-linked account or API user is missing a
          wrapped decryption key for it, usually because it was saved from a device before that
          principal was linked. Repairing re-encrypts each unhealthy item for every
          currently-linked account and API user.
        </Text>
      </View>

      {unhealthyResources.length > 0 && health ? (
        <View className="gap-3">
          <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
            Unhealthy resources
          </Text>
          {unhealthyResources.map((resource) => (
            <UnhealthyResourceRow
              key={resource.resourceId}
              linkedPrincipals={health.linkedPrincipals}
              resource={resource}
              tokens={tokens}
            />
          ))}
          <Pressable
            className={`items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
            disabled={isRepairing}
            onPress={() => {
              void handleRepairAll();
            }}
          >
            <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
              {isRepairing
                ? 'Repairing...'
                : `Repair ${unhealthyResources.length} unhealthy resource${unhealthyResources.length === 1 ? '' : 's'}`}
            </Text>
          </Pressable>
          {orphanedResources.length > 0 ? (
            <Pressable
              className="items-center rounded-full border border-rose-300 px-4 py-4"
              disabled={isDeletingOrphaned}
              onPress={() => {
                void handleDeleteOrphaned();
              }}
            >
              <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-rose-700">
                {isDeletingOrphaned
                  ? 'Deleting...'
                  : `Delete ${orphanedResources.length} orphaned resource${orphanedResources.length === 1 ? '' : 's'}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {failedRepairs.length > 0 && health ? (
        <View className="gap-3">
          <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
            Could not repair
          </Text>
          {failedRepairs.map(({ message, resource }) => (
            <FailedRepairRow
              key={resource.resourceId}
              linkedPrincipals={health.linkedPrincipals}
              message={message}
              resource={resource}
              tokens={tokens}
            />
          ))}
          <Pressable
            className="items-center rounded-full border border-rose-300 px-4 py-4"
            disabled={isDeletingUnrepairable}
            onPress={() => {
              void handleDeleteUnrepairable();
            }}
          >
            <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-rose-700">
              {isDeletingUnrepairable
                ? 'Deleting...'
                : `Delete ${failedRepairs.length} unrepairable resource${failedRepairs.length === 1 ? '' : 's'}`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {statusMessage ? <Text className={`text-sm ${tokens.body}`}>{statusMessage}</Text> : null}
    </ScreenShell>
  );
}

function UnhealthyResourceRow({
  linkedPrincipals,
  resource,
  tokens,
}: {
  linkedPrincipals: HealthLinkedPrincipal[];
  resource: ResourceHealth;
  tokens: ThemeTokenSet;
}) {
  const missingPrincipals = resource.missingPrincipalIds.map((principalId) =>
    describePrincipal(linkedPrincipals, principalId),
  );

  return (
    <View className={`gap-1 rounded-[18px] border border-stone-300 px-4 py-3 dark:border-slate-700`}>
      <Text className={`text-sm font-semibold ${tokens.title}`}>
        {resource.resourceKind === 'card' ? 'Card' : 'Folder'} {resource.resourceId}
      </Text>
      <Text className={`text-xs ${tokens.body}`}>
        Missing wrapped DEK for: {missingPrincipals.join(', ')}
      </Text>
    </View>
  );
}

function FailedRepairRow({
  linkedPrincipals,
  message,
  resource,
  tokens,
}: {
  linkedPrincipals: HealthLinkedPrincipal[];
  message: string;
  resource: ResourceHealth;
  tokens: ThemeTokenSet;
}) {
  const missingPrincipals = resource.missingPrincipalIds.map((principalId) =>
    describePrincipal(linkedPrincipals, principalId),
  );
  const recipientPrincipals = resource.recipientPrincipalIds.map((principalId) =>
    describePrincipal(linkedPrincipals, principalId),
  );

  return (
    <View className={`gap-1 rounded-[18px] border border-stone-300 px-4 py-3 dark:border-slate-700`}>
      <Text className={`text-sm font-semibold ${tokens.title}`}>
        {resource.resourceKind === 'card' ? 'Card' : 'Folder'} {resource.resourceId}
      </Text>
      <Text className="text-xs text-rose-600">{message}</Text>
      <Text className={`text-xs ${tokens.body}`}>
        Missing wrapped DEK for: {missingPrincipals.join(', ')}
      </Text>
      <Text className={`text-xs ${tokens.body}`}>
        Can currently be decrypted by:{' '}
        {recipientPrincipals.length > 0 ? recipientPrincipals.join(', ') : 'no one currently linked'}
      </Text>
    </View>
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

function buildDeletionSummaryMessage(summary: DeletionSummary) {
  const deletedTotal = summary.deletedCards + summary.deletedFolders;

  if (deletedTotal === 0) {
    return 'No resources needed to be deleted.';
  }

  const segments = [];

  if (summary.deletedCards > 0) {
    segments.push(`${summary.deletedCards} card${summary.deletedCards === 1 ? '' : 's'}`);
  }

  if (summary.deletedFolders > 0) {
    segments.push(`${summary.deletedFolders} folder${summary.deletedFolders === 1 ? '' : 's'}`);
  }

  return `Deleted ${segments.join(' and ')}.`;
}

function confirmDeletion(title: string, message: string) {
  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      {
        style: 'cancel',
        text: 'Cancel',
        onPress: () => resolve(false),
      },
      {
        style: 'destructive',
        text: 'Delete',
        onPress: () => resolve(true),
      },
    ]);
  });
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
