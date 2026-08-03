import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
  fetchE2eeHealth,
  type E2eeHealthResponse,
  type HealthLinkedPrincipal,
  type ResourceHealth,
} from '../features/e2ee/health-api';
import { useAppTheme } from '../features/theme/theme-context';
import { themeTokens, type ThemeTokenSet } from '../theme/theme-tokens';

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
        } catch {
          failedCount += 1;
        }
      }

      await loadHealth();

      if (isMountedRef.current) {
        setStatusMessage(buildRepairSummaryMessage(repairedCount, failedCount));
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
