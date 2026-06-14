import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import {
  fetchNotes,
  type SaveNotePayload,
  updateNote,
} from '../features/e2ee/test-note-api';
import {
  createMobileOfflineNotesSyncAdapter,
  getMobileOfflineNotesProvider,
} from '../features/e2ee/offline-notes';
import { getNativeAuthModule } from '../features/e2ee/native-runtime';
import type {
  AuthApiResponse,
  KekMigrationStatusResponse,
} from '../features/auth/auth-api';
import type { PersistedLinkedKek } from '../features/auth/auth-storage';
import { useAuth } from '../features/auth/auth-context';
import { useAppTheme } from '../features/theme/theme-context';
import { themeTokens } from '../theme/theme-tokens';

type MigrationProgress = {
  completed: number;
  total: number;
};

type SyncOfflineNotesArgs = {
  activeLinkedKekId: string;
  linkedKeks: PersistedLinkedKek[];
  nextSession: AuthApiResponse;
};

type ThemeMode = 'light' | 'dark';

export function AccountSettingsScreen() {
  const {
    activeKekId,
    backendUrl,
    deleteAccount,
    kekMigrationStatus,
    linkedKeks,
    persistLinkedKeks,
    refreshKekMigrationStatus,
    rotatePassword,
    runWithFreshSession,
    session,
  } = useAuth();
  const { themeMode } = useAppTheme();
  const router = useRouter();
  const tokens = themeTokens[themeMode];
  const [nextPassword, setNextPassword] = useState('');
  const [migrationPasswords, setMigrationPasswords] = useState<Record<string, string>>({});
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isRotatingPassword, setIsRotatingPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const missingMigrationKeks = session
    ? session.kekMetadatas.filter(
        (metadata) => !linkedKeks.some((entry) => entry.kekPublicKey === metadata.kekPublicKey),
      )
    : [];
  const needsMigration =
    !!session &&
    !!kekMigrationStatus &&
    session.kekMetadatas.length > 1 &&
    !kekMigrationStatus.allDeksUseLatestKek;

  return (
    <ScreenShell
      themeMode={themeMode}
      title="Account settings"
    >
      <Text className={`text-sm ${tokens.body}`}>
        Signed in as {session?.user.email ?? 'unknown'}
      </Text>

      {session?.currentPrincipal.kind === 'user' ? (
        <View className="gap-3">
          <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
            API users
          </Text>
          <Text className={`text-sm ${tokens.body}`}>
            Create and manage API users linked to your encrypted notes account.
          </Text>
          <Pressable
            className={`items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
            onPress={() => {
              router.push('/api-users');
            }}
          >
            <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
              Open API user dashboard
            </Text>
          </Pressable>
        </View>
      ) : null}

      <PasswordRotationSection
        backendUrl={backendUrl}
        isDeletingAccount={isDeletingAccount}
        isMigrating={isMigrating}
        isRotatingPassword={isRotatingPassword}
        migrationPasswords={migrationPasswords}
        nextPassword={nextPassword}
        persistLinkedKeks={persistLinkedKeks}
        refreshKekMigrationStatus={refreshKekMigrationStatus}
        rotatePassword={rotatePassword}
        runWithFreshSession={runWithFreshSession}
        setIsMigrating={setIsMigrating}
        setIsRotatingPassword={setIsRotatingPassword}
        setMigrationPasswords={setMigrationPasswords}
        setMigrationProgress={setMigrationProgress}
        setNextPassword={setNextPassword}
        setStatusMessage={setStatusMessage}
        themeMode={themeMode}
      />

      {needsMigration ? (
        <KekMigrationSection
          activeKekId={activeKekId}
          backendUrl={backendUrl}
          isDeletingAccount={isDeletingAccount}
          isMigrating={isMigrating}
          kekMigrationStatus={kekMigrationStatus}
          linkedKeks={linkedKeks}
          migrationPasswords={migrationPasswords}
          migrationProgress={migrationProgress}
          missingMigrationKeks={missingMigrationKeks}
          persistLinkedKeks={persistLinkedKeks}
          refreshKekMigrationStatus={refreshKekMigrationStatus}
          runWithFreshSession={runWithFreshSession}
          session={session}
          setIsMigrating={setIsMigrating}
          setMigrationPasswords={setMigrationPasswords}
          setMigrationProgress={setMigrationProgress}
          setStatusMessage={setStatusMessage}
          themeMode={themeMode}
          tokens={tokens}
        />
      ) : null}

      <DangerZoneSection
        deleteAccount={deleteAccount}
        isDeletingAccount={isDeletingAccount}
        isMigrating={isMigrating}
        isRotatingPassword={isRotatingPassword}
        session={session}
        setIsDeletingAccount={setIsDeletingAccount}
        setStatusMessage={setStatusMessage}
        themeMode={themeMode}
      />

      {statusMessage ? <Text className={`text-sm ${tokens.body}`}>{statusMessage}</Text> : null}
    </ScreenShell>
  );
}

function PasswordRotationSection({
  backendUrl,
  isDeletingAccount,
  isMigrating,
  isRotatingPassword,
  migrationPasswords,
  nextPassword,
  persistLinkedKeks,
  refreshKekMigrationStatus,
  rotatePassword,
  runWithFreshSession,
  setIsMigrating,
  setIsRotatingPassword,
  setMigrationPasswords,
  setMigrationProgress,
  setNextPassword,
  setStatusMessage,
  themeMode,
}: Readonly<{
  backendUrl: string;
  isDeletingAccount: boolean;
  isMigrating: boolean;
  isRotatingPassword: boolean;
  migrationPasswords: Record<string, string>;
  nextPassword: string;
  persistLinkedKeks: (linkedKeks: PersistedLinkedKek[]) => Promise<void>;
  refreshKekMigrationStatus: () => Promise<KekMigrationStatusResponse | null>;
  rotatePassword: (newPassword: string) => Promise<{
    activeKekId: string;
    linkedKeks: PersistedLinkedKek[];
    session: AuthApiResponse;
  }>;
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  setIsMigrating: (value: boolean) => void;
  setIsRotatingPassword: (value: boolean) => void;
  setMigrationPasswords: (value: Record<string, string>) => void;
  setMigrationProgress: (value: MigrationProgress | null) => void;
  setNextPassword: (value: string) => void;
  setStatusMessage: (value: string) => void;
  themeMode: ThemeMode;
}>) {
  const tokens = themeTokens[themeMode];

  return (
    <View className="gap-3">
      <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
        Password rotation
      </Text>
      <Text className={`text-sm ${tokens.body}`}>
        Create the next KEK epoch by rotating your account password.
      </Text>
      <TextInput
        autoCapitalize="none"
        className={`rounded-[22px] border px-4 py-3 text-base ${tokens.card} ${tokens.title}`}
        onChangeText={setNextPassword}
        placeholder="Type the new password for the next KEK epoch"
        placeholderTextColor={themeMode === 'dark' ? '#94a3b8' : '#78716c'}
        secureTextEntry
        value={nextPassword}
      />
      <Pressable
        className={`items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
        disabled={isDeletingAccount || isRotatingPassword || isMigrating}
        onPress={() => {
          void rotatePasswordFlow({
            backendUrl,
            migrationPasswords,
            nextPassword,
            persistLinkedKeks,
            refreshKekMigrationStatus,
            rotatePassword,
            runWithFreshSession,
            setIsMigrating,
            setIsRotatingPassword,
            setMigrationPasswords,
            setMigrationProgress,
            setNextPassword,
            setStatusMessage,
          });
        }}
      >
        {isRotatingPassword ? (
          <ActivityIndicator color={themeMode === 'dark' ? '#020617' : '#ffffff'} />
        ) : (
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
            Rotate password and start migration
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function KekMigrationSection({
  activeKekId,
  backendUrl,
  isDeletingAccount,
  isMigrating,
  kekMigrationStatus,
  linkedKeks,
  migrationPasswords,
  migrationProgress,
  missingMigrationKeks,
  persistLinkedKeks,
  refreshKekMigrationStatus,
  runWithFreshSession,
  session,
  setIsMigrating,
  setMigrationPasswords,
  setMigrationProgress,
  setStatusMessage,
  themeMode,
  tokens,
}: Readonly<{
  activeKekId: string | null;
  backendUrl: string;
  isDeletingAccount: boolean;
  isMigrating: boolean;
  kekMigrationStatus: KekMigrationStatusResponse | null;
  linkedKeks: PersistedLinkedKek[];
  migrationPasswords: Record<string, string>;
  migrationProgress: MigrationProgress | null;
  missingMigrationKeks: AuthApiResponse['kekMetadatas'];
  persistLinkedKeks: (linkedKeks: PersistedLinkedKek[]) => Promise<void>;
  refreshKekMigrationStatus: () => Promise<KekMigrationStatusResponse | null>;
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  session: AuthApiResponse | null;
  setIsMigrating: (value: boolean) => void;
  setMigrationPasswords: (value: Record<string, string> | ((currentPasswords: Record<string, string>) => Record<string, string>)) => void;
  setMigrationProgress: (value: MigrationProgress | null) => void;
  setStatusMessage: (value: string) => void;
  themeMode: ThemeMode;
  tokens: (typeof themeTokens)[ThemeMode];
}>) {
  return (
    <View className="gap-3 rounded-[28px] border border-amber-300 bg-amber-50 px-5 py-6 dark:bg-amber-950/40">
      <Text className="text-sm font-semibold uppercase tracking-[2px] text-amber-900 dark:text-amber-100">
        KEK migration
      </Text>
      <Text className="text-sm text-amber-950 dark:text-amber-50">
        Continue migration to epoch {kekMigrationStatus?.latestKekEpochVersion ?? '?'}.{' '}
      </Text>
      {missingMigrationKeks.map((metadata) => (
        <TextInput
          autoCapitalize="none"
          className={`rounded-[22px] border px-4 py-3 text-base ${tokens.card} ${tokens.title}`}
          key={metadata.kekPublicKey}
          onChangeText={(value) =>
            setMigrationPasswords((currentPasswords) => ({
              ...currentPasswords,
              [metadata.kekPublicKey]: value,
            }))
          }
          placeholder={`Type the password for KEK epoch ${metadata.kekEpochVersion}`}
          placeholderTextColor={themeMode === 'dark' ? '#94a3b8' : '#78716c'}
          secureTextEntry
          value={migrationPasswords[metadata.kekPublicKey] ?? ''}
        />
      ))}
      {migrationProgress ? (
        <View className="gap-2">
          <View className="h-3 overflow-hidden rounded-full bg-amber-100 dark:bg-amber-900/70">
            <View
              className="h-full rounded-full bg-amber-500"
              style={{
                width: `${migrationProgress.total === 0 ? 100 : (migrationProgress.completed / migrationProgress.total) * 100}%`,
              }}
            />
          </View>
          <Text className="text-sm text-amber-900 dark:text-amber-100">
            Migrated {migrationProgress.completed} of {migrationProgress.total} DEKs.
          </Text>
        </View>
      ) : null}
      {isMigrating ? null : (
        <Pressable
          className="items-center rounded-full border border-amber-400 px-4 py-4"
          disabled={isDeletingAccount}
          onPress={() => {
            void continueMigrationFlow({
              activeKekId,
              backendUrl,
              linkedKeks,
              migrationPasswords,
              persistLinkedKeks,
              refreshKekMigrationStatus,
              runWithFreshSession,
              session,
              setIsMigrating,
              setMigrationPasswords,
              setMigrationProgress,
              setStatusMessage,
            });
          }}
        >
          <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-amber-900 dark:text-amber-100">
            Continue migration
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function DangerZoneSection({
  deleteAccount,
  isDeletingAccount,
  isMigrating,
  isRotatingPassword,
  session,
  setIsDeletingAccount,
  setStatusMessage,
  themeMode,
}: Readonly<{
  deleteAccount: () => Promise<void>;
  isDeletingAccount: boolean;
  isMigrating: boolean;
  isRotatingPassword: boolean;
  session: AuthApiResponse | null;
  setIsDeletingAccount: (value: boolean) => void;
  setStatusMessage: (value: string) => void;
  themeMode: ThemeMode;
}>) {
  return (
    <View className="gap-3 rounded-[28px] border border-rose-300 bg-rose-50 px-5 py-6 dark:border-rose-800 dark:bg-rose-950/40">
      <Text className="text-sm font-semibold uppercase tracking-[2px] text-rose-700 dark:text-rose-200">
        Danger zone
      </Text>
      <Text className="text-sm text-rose-800 dark:text-rose-100">
        Delete your account permanently. This removes the user, linked notes, DEKs, KEKs, and stored encrypted data.
      </Text>
      <Pressable
        className="items-center rounded-full border border-rose-400 px-4 py-4 dark:border-rose-700"
        disabled={isDeletingAccount || isMigrating || isRotatingPassword || !session}
        onPress={() => {
          void deleteAccountFlow({
            deleteAccount,
            session,
            setIsDeletingAccount,
            setStatusMessage,
          });
        }}
      >
        {isDeletingAccount ? (
          <ActivityIndicator color={themeMode === 'dark' ? '#fecdd3' : '#be123c'} />
        ) : (
          <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-rose-700 dark:text-rose-200">
            Delete account
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function confirmDeleteAccount(email: string) {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Delete account',
      `Delete account ${email}? This permanently removes the user, linked notes, DEKs, KEKs, and stored encrypted data.`,
      [
        {
          style: 'cancel',
          text: 'Cancel',
          onPress: () => resolve(false),
        },
        {
          style: 'destructive',
          text: 'Delete account',
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      },
    );
  });
}

async function continueKekMigrationFlow({
  activeSession,
  backendUrl,
  baseLinkedKeks,
  latestKekId,
  migrationPasswords,
  persistLinkedKeks,
  refreshKekMigrationStatus,
  runWithFreshSession,
  setIsMigrating,
  setMigrationPasswords,
  setMigrationProgress,
  setStatusMessage,
}: {
  activeSession: AuthApiResponse;
  backendUrl: string;
  baseLinkedKeks: PersistedLinkedKek[];
  latestKekId: string;
  migrationPasswords: Record<string, string>;
  persistLinkedKeks: (linkedKeks: PersistedLinkedKek[]) => Promise<void>;
  refreshKekMigrationStatus: () => Promise<KekMigrationStatusResponse | null>;
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  setIsMigrating: (value: boolean) => void;
  setMigrationPasswords: (value: Record<string, string>) => void;
  setMigrationProgress: (value: MigrationProgress | null) => void;
  setStatusMessage: (value: string) => void;
}) {
  const workingLinkedKeks = await deriveMissingLinkedKeks({
    baseLinkedKeks,
    email: activeSession.user.email,
    missingMetadatas: activeSession.kekMetadatas.filter(
      (metadata) => !baseLinkedKeks.some((entry) => entry.kekPublicKey === metadata.kekPublicKey),
    ),
    passwordsByKekId: migrationPasswords,
  });
  const latestLinkedKek = requireLinkedKek(workingLinkedKeks, latestKekId);
  const remoteNotes = await runWithFreshSession((freshSession) =>
    fetchNotes({
      baseUrl: backendUrl,
      token: freshSession.token,
    }));
  const notesToRewrap = remoteNotes.filter(
    (note) => note.encryptedDek.kekPublicKey !== latestLinkedKek.kekPublicKey,
  );

  setIsMigrating(true);
  setMigrationProgress({ completed: 0, total: notesToRewrap.length });

  try {
    for (let index = 0; index < notesToRewrap.length; index += 1) {
      const note = notesToRewrap[index];
      const currentLinkedKek = workingLinkedKeks.find(
        (entry) => entry.kekPublicKey === note.encryptedDek.kekPublicKey,
      );
      const { rewrapAsymmetricEncryptedDek } = await getNativeAuthModule();

      if (!currentLinkedKek) {
        throw new Error(
          `Missing the local KEK for epoch-linked id ${note.encryptedDek.kekPublicKey}. Provide the matching older password first.`,
        );
      }

      await runWithFreshSession(async (freshSession) =>
        updateNote({
          baseUrl: backendUrl,
          noteId: note.id,
          payload: {
            encryptedDeks: [
              {
                ...(await rewrapAsymmetricEncryptedDek(
                  note,
                  currentLinkedKek.cryptKey,
                  latestLinkedKek.kekPublicKey,
                )),
                userId: freshSession.user.id,
              },
            ],
            encryptedPayload: note.encryptedPayload,
          } satisfies SaveNotePayload,
          token: freshSession.token,
        }));

      setMigrationProgress({ completed: index + 1, total: notesToRewrap.length });
    }

    await persistLinkedKeks(workingLinkedKeks);
    setMigrationPasswords({});

    const finalStatus = await refreshKekMigrationStatus();

    if (!finalStatus?.allDeksUseLatestKek) {
      throw new Error('The backend still reports DEKs on older KEK epochs after migration.');
    }

    await syncOfflineNotesFlow({
      activeLinkedKekId: latestKekId,
      backendUrl,
      linkedKeks: workingLinkedKeks,
      nextSession: activeSession,
      refreshKekMigrationStatus,
      runWithFreshSession,
    });

    const dekLabel = notesToRewrap.length === 1 ? 'DEK' : 'DEKs';
    const migrationMessage =
      notesToRewrap.length === 0
        ? 'All DEKs already use the latest KEK epoch.'
        : `Rewrapped ${notesToRewrap.length} ${dekLabel} onto the latest KEK epoch.`;

    setStatusMessage(migrationMessage);
  } finally {
    setIsMigrating(false);
    setMigrationProgress(null);
  }
}

async function continueMigrationFlow({
  activeKekId,
  backendUrl,
  linkedKeks,
  migrationPasswords,
  persistLinkedKeks,
  refreshKekMigrationStatus,
  runWithFreshSession,
  session,
  setIsMigrating,
  setMigrationPasswords,
  setMigrationProgress,
  setStatusMessage,
}: {
  activeKekId: string | null;
  backendUrl: string;
  linkedKeks: PersistedLinkedKek[];
  migrationPasswords: Record<string, string>;
  persistLinkedKeks: (linkedKeks: PersistedLinkedKek[]) => Promise<void>;
  refreshKekMigrationStatus: () => Promise<KekMigrationStatusResponse | null>;
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  session: AuthApiResponse | null;
  setIsMigrating: (value: boolean) => void;
  setMigrationPasswords: (value: Record<string, string>) => void;
  setMigrationProgress: (value: MigrationProgress | null) => void;
  setStatusMessage: (value: string) => void;
}) {
  if (!session || !activeKekId) {
    return;
  }

  try {
    await continueKekMigrationFlow({
      activeSession: session,
      backendUrl,
      baseLinkedKeks: linkedKeks,
      latestKekId: activeKekId,
      migrationPasswords,
      persistLinkedKeks,
      refreshKekMigrationStatus,
      runWithFreshSession,
      setIsMigrating,
      setMigrationPasswords,
      setMigrationProgress,
      setStatusMessage,
    });
  } catch (error) {
    setStatusMessage(
      error instanceof Error ? error.message : 'Unable to continue the KEK migration.',
    );
  }
}

async function deleteAccountFlow({
  deleteAccount,
  session,
  setIsDeletingAccount,
  setStatusMessage,
}: {
  deleteAccount: () => Promise<void>;
  session: AuthApiResponse | null;
  setIsDeletingAccount: (value: boolean) => void;
  setStatusMessage: (value: string) => void;
}) {
  if (!session) {
    return;
  }

  const confirmed = await confirmDeleteAccount(session.user.email);

  if (!confirmed) {
    return;
  }

  setStatusMessage('');
  setIsDeletingAccount(true);

  try {
    await deleteAccount();
  } catch (error) {
    setStatusMessage(
      error instanceof Error ? error.message : 'Unable to delete the account.',
    );
  } finally {
    setIsDeletingAccount(false);
  }
}

async function rotatePasswordFlow({
  backendUrl,
  migrationPasswords,
  nextPassword,
  persistLinkedKeks,
  refreshKekMigrationStatus,
  rotatePassword,
  runWithFreshSession,
  setIsMigrating,
  setIsRotatingPassword,
  setMigrationPasswords,
  setMigrationProgress,
  setNextPassword,
  setStatusMessage,
}: {
  backendUrl: string;
  migrationPasswords: Record<string, string>;
  nextPassword: string;
  persistLinkedKeks: (linkedKeks: PersistedLinkedKek[]) => Promise<void>;
  refreshKekMigrationStatus: () => Promise<KekMigrationStatusResponse | null>;
  rotatePassword: (newPassword: string) => Promise<{
    activeKekId: string;
    linkedKeks: PersistedLinkedKek[];
    session: AuthApiResponse;
  }>;
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  setIsMigrating: (value: boolean) => void;
  setIsRotatingPassword: (value: boolean) => void;
  setMigrationPasswords: (value: Record<string, string>) => void;
  setMigrationProgress: (value: MigrationProgress | null) => void;
  setNextPassword: (value: string) => void;
  setStatusMessage: (value: string) => void;
}) {
  setIsRotatingPassword(true);

  try {
    const rotationResult = await rotatePassword(nextPassword);

    setNextPassword('');
    await continueKekMigrationFlow({
      activeSession: rotationResult.session,
      backendUrl,
      baseLinkedKeks: rotationResult.linkedKeks,
      latestKekId: rotationResult.activeKekId,
      migrationPasswords,
      persistLinkedKeks,
      refreshKekMigrationStatus,
      runWithFreshSession,
      setIsMigrating,
      setMigrationPasswords,
      setMigrationProgress,
      setStatusMessage,
    });
  } catch (error) {
    setStatusMessage(
      error instanceof Error ? error.message : 'Unable to rotate the password.',
    );
  } finally {
    setIsRotatingPassword(false);
  }
}

async function syncOfflineNotesFlow({
  activeLinkedKekId,
  backendUrl,
  linkedKeks,
  nextSession,
  refreshKekMigrationStatus,
  runWithFreshSession,
}: SyncOfflineNotesArgs & {
  backendUrl: string;
  refreshKekMigrationStatus: () => Promise<KekMigrationStatusResponse | null>;
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
}) {
  const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
  const adapter = createMobileOfflineNotesSyncAdapter({
    activeKekId: activeLinkedKekId,
    backendUrl,
    linkedKeks,
    runWithFreshSession,
    session: nextSession,
  });

  await mobileOfflineNotesProvider.sync(adapter);
  await refreshKekMigrationStatus();
}

function requireLinkedKek(
  linkedKeks: { cryptKey: Uint8Array; kekPublicKey: string }[],
  activeKekId: string | null,
) {
  if (!activeKekId) {
    throw new Error('No active KEK is linked on this device. Log in again.');
  }

  const linkedKek = linkedKeks.find((entry) => entry.kekPublicKey === activeKekId) ?? null;

  if (!linkedKek) {
    throw new Error('The active KEK is missing from local storage. Log in again.');
  }

  return linkedKek;
}

async function deriveMissingLinkedKeks({
  baseLinkedKeks,
  email,
  missingMetadatas,
  passwordsByKekId,
}: {
  baseLinkedKeks: { cryptKey: Uint8Array; kekEpochVersion: number; kekPublicKey: string; saltHex: string }[];
  email: string;
  missingMetadatas: { kekEpochVersion: number; kekPublicKey: string }[];
  passwordsByKekId: Record<string, string>;
}) {
  if (missingMetadatas.length === 0) {
    return baseLinkedKeks;
  }

  const saltHex = baseLinkedKeks[0]?.saltHex;

  if (!saltHex) {
    throw new Error('The current password salt is missing from local storage. Log in again.');
  }

  const { deriveCredentials } = await getNativeAuthModule();

  const linkedKeks = [...baseLinkedKeks];

  for (const metadata of missingMetadatas) {
    const password = passwordsByKekId[metadata.kekPublicKey]?.trim();

    if (!password) {
      throw new Error(
        `Enter the password for KEK epoch ${metadata.kekEpochVersion} before continuing the migration.`,
      );
    }

    const credentials = await deriveCredentials(email, password, saltHex);

    linkedKeks.push({
      cryptKey: credentials.cryptKey,
      kekEpochVersion: metadata.kekEpochVersion,
      kekPublicKey: metadata.kekPublicKey,
      saltHex,
    });
  }

  return linkedKeks.sort((left, right) => right.kekEpochVersion - left.kekEpochVersion);
}