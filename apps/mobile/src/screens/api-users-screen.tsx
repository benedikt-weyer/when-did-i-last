import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  type DimensionValue,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { useAuth } from '../features/auth/auth-context';
import {
  createApiUserRequest,
  deleteApiUserRequest,
  fetchApiUser,
  fetchApiUsers,
  fetchLinkedPrincipals,
  provisionApiUserDeksRequest,
  type ApiUserResponse,
  type AuthApiResponse,
} from '../features/auth/auth-api';
import type { PersistedLinkedKek } from '../features/auth/auth-storage';
import { fetchNotes } from '../features/e2ee/test-note-api';
import { getNativeAuthModule } from '../features/e2ee/native-runtime';
import { useAppTheme } from '../features/theme/theme-context';
import { themeTokens } from '../theme/theme-tokens';

type ApiUserView = ApiUserResponse & {
  label: string;
};

type ProvisionProgress = {
  apiUserId: string;
  completed: number;
  total: number;
  username: string;
};

type ApiUsersSetter = Dispatch<SetStateAction<ApiUserView[]>>;
type NullableStringSetter = Dispatch<SetStateAction<string | null>>;
type NullableProgressSetter = Dispatch<SetStateAction<ProvisionProgress | null>>;

export function ApiUsersScreen() {
  const { backendUrl, linkedKeks, runWithFreshSession, session } = useAuth();
  const { themeMode } = useAppTheme();
  const tokens = themeTokens[themeMode];
  const router = useRouter();
  const [apiUserLabel, setApiUserLabel] = useState('');
  const [apiUsers, setApiUsers] = useState<ApiUserView[]>([]);
  const [apiUserProgress, setApiUserProgress] = useState<ProvisionProgress | null>(null);
  const [deletingApiUserId, setDeletingApiUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreatingApiUser, setIsCreatingApiUser] = useState(false);
  const [isLoadingApiUsers, setIsLoadingApiUsers] = useState(false);
  const [latestApiToken, setLatestApiToken] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  const isOwnerSession = session?.currentPrincipal.kind === 'user';

  useEffect(() => {
    if (session?.currentPrincipal.kind !== 'user') {
      setApiUsers([]);
      return;
    }

    let isActive = true;

    void loadApiUsers({
      backendUrl,
      linkedKeks,
      runWithFreshSession,
      setApiUsers: (nextApiUsers) => {
        if (isActive) {
          setApiUsers(nextApiUsers);
        }
      },
      setErrorMessage: (nextError) => {
        if (isActive) {
          setErrorMessage(nextError);
        }
      },
      setIsLoadingApiUsers: (nextLoading) => {
        if (isActive) {
          setIsLoadingApiUsers(nextLoading);
        }
      },
    });

    return () => {
      isActive = false;
    };
  }, [backendUrl, linkedKeks, runWithFreshSession, session]);

  function refreshApiUsers() {
    if (session?.currentPrincipal.kind !== 'user') {
      return;
    }

    setStatusMessage('');
    void loadApiUsers({
      backendUrl,
      linkedKeks,
      runWithFreshSession,
      setApiUsers,
      setErrorMessage,
      setIsLoadingApiUsers,
    });
  }

  return (
    <ScreenShell themeMode={themeMode} title="API users">
      <View className="gap-3">
        <Pressable
          className={`self-start rounded-full border px-4 py-2 ${tokens.card}`}
          onPress={() => {
            router.back();
          }}
        >
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.title}`}>
            Back to account settings
          </Text>
        </Pressable>
        <Text className={`text-sm ${tokens.body}`}>
          Create, provision, and remove API users linked to your account.
        </Text>
      </View>

      {isOwnerSession ? (
        <OwnerDashboard
          apiUserLabel={apiUserLabel}
          apiUserProgress={apiUserProgress}
          apiUsers={apiUsers}
          backendUrl={backendUrl}
          deletingApiUserId={deletingApiUserId}
          isCreatingApiUser={isCreatingApiUser}
          isLoadingApiUsers={isLoadingApiUsers}
          latestApiToken={latestApiToken}
          linkedKeks={linkedKeks}
          refreshApiUsers={refreshApiUsers}
          runWithFreshSession={runWithFreshSession}
          session={session}
          setApiUserLabel={setApiUserLabel}
          setApiUserProgress={setApiUserProgress}
          setApiUsers={setApiUsers}
          setDeletingApiUserId={setDeletingApiUserId}
          setErrorMessage={setErrorMessage}
          setIsCreatingApiUser={setIsCreatingApiUser}
          setLatestApiToken={setLatestApiToken}
          setStatusMessage={setStatusMessage}
          themeMode={themeMode}
        />
      ) : (
        <UnavailableCard
          bodyClassName={tokens.body}
          cardClassName={tokens.card}
          kickerClassName={tokens.kicker}
        />
      )}

      {errorMessage ? <Text className="text-sm text-rose-700 dark:text-rose-200">{errorMessage}</Text> : null}
      {statusMessage ? <Text className={`text-sm ${tokens.body}`}>{statusMessage}</Text> : null}
    </ScreenShell>
  );
}

function OwnerDashboard({
  apiUserLabel,
  apiUserProgress,
  apiUsers,
  backendUrl,
  deletingApiUserId,
  isCreatingApiUser,
  isLoadingApiUsers,
  latestApiToken,
  linkedKeks,
  refreshApiUsers,
  runWithFreshSession,
  session,
  setApiUserLabel,
  setApiUserProgress,
  setApiUsers,
  setDeletingApiUserId,
  setErrorMessage,
  setIsCreatingApiUser,
  setLatestApiToken,
  setStatusMessage,
  themeMode,
}: Readonly<{
  apiUserLabel: string;
  apiUserProgress: ProvisionProgress | null;
  apiUsers: ApiUserView[];
  backendUrl: string;
  deletingApiUserId: string | null;
  isCreatingApiUser: boolean;
  isLoadingApiUsers: boolean;
  latestApiToken: string | null;
  linkedKeks: PersistedLinkedKek[];
  refreshApiUsers: () => void;
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  session: AuthApiResponse | null;
  setApiUserLabel: Dispatch<SetStateAction<string>>;
  setApiUserProgress: NullableProgressSetter;
  setApiUsers: ApiUsersSetter;
  setDeletingApiUserId: Dispatch<SetStateAction<string | null>>;
  setErrorMessage: NullableStringSetter;
  setIsCreatingApiUser: Dispatch<SetStateAction<boolean>>;
  setLatestApiToken: Dispatch<SetStateAction<string | null>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  themeMode: 'light' | 'dark';
}>) {
  const tokens = themeTokens[themeMode];

  return (
    <>
      <CreateApiUserPanel
        apiUserLabel={apiUserLabel}
        apiUserProgress={apiUserProgress}
        backendUrl={backendUrl}
        isCreatingApiUser={isCreatingApiUser}
        isLoadingApiUsers={isLoadingApiUsers}
        latestApiToken={latestApiToken}
        linkedKeks={linkedKeks}
        refreshApiUsers={refreshApiUsers}
        runWithFreshSession={runWithFreshSession}
        session={session}
        setApiUserLabel={setApiUserLabel}
        setApiUserProgress={setApiUserProgress}
        setApiUsers={setApiUsers}
        setErrorMessage={setErrorMessage}
        setIsCreatingApiUser={setIsCreatingApiUser}
        setLatestApiToken={setLatestApiToken}
        setStatusMessage={setStatusMessage}
        themeMode={themeMode}
      />

      <ApiUsersList
        apiUserProgress={apiUserProgress}
        apiUsers={apiUsers}
        backendUrl={backendUrl}
        deletingApiUserId={deletingApiUserId}
        isCreatingApiUser={isCreatingApiUser}
        isLoadingApiUsers={isLoadingApiUsers}
        linkedKeks={linkedKeks}
        runWithFreshSession={runWithFreshSession}
        session={session}
        setApiUserProgress={setApiUserProgress}
        setApiUsers={setApiUsers}
        setDeletingApiUserId={setDeletingApiUserId}
        setErrorMessage={setErrorMessage}
        setStatusMessage={setStatusMessage}
        tokens={tokens}
      />
    </>
  );
}

function CreateApiUserPanel({
  apiUserLabel,
  apiUserProgress,
  backendUrl,
  isCreatingApiUser,
  isLoadingApiUsers,
  latestApiToken,
  linkedKeks,
  refreshApiUsers,
  runWithFreshSession,
  session,
  setApiUserLabel,
  setApiUserProgress,
  setApiUsers,
  setErrorMessage,
  setIsCreatingApiUser,
  setLatestApiToken,
  setStatusMessage,
  themeMode,
}: Readonly<{
  apiUserLabel: string;
  apiUserProgress: ProvisionProgress | null;
  backendUrl: string;
  isCreatingApiUser: boolean;
  isLoadingApiUsers: boolean;
  latestApiToken: string | null;
  linkedKeks: PersistedLinkedKek[];
  refreshApiUsers: () => void;
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  session: AuthApiResponse | null;
  setApiUserLabel: Dispatch<SetStateAction<string>>;
  setApiUserProgress: NullableProgressSetter;
  setApiUsers: ApiUsersSetter;
  setErrorMessage: NullableStringSetter;
  setIsCreatingApiUser: Dispatch<SetStateAction<boolean>>;
  setLatestApiToken: Dispatch<SetStateAction<string | null>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  themeMode: 'light' | 'dark';
}>) {
  const tokens = themeTokens[themeMode];

  return (
    <View className={`gap-3 rounded-[22px] border px-4 py-4 ${tokens.card}`}>
      <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
        Create API user
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        className={`rounded-[18px] border px-4 py-4 text-base ${tokens.card} ${tokens.title}`}
        onChangeText={setApiUserLabel}
        placeholder="CLI integration, automation, server agent"
        placeholderTextColor={themeMode === 'dark' ? '#94a3b8' : '#78716c'}
        value={apiUserLabel}
      />
      <View className="flex-row gap-3">
        <Pressable
          className={`flex-1 items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
          disabled={isCreatingApiUser || !!apiUserProgress || !apiUserLabel.trim()}
          onPress={() => {
            void handleCreateApiUser({
              apiUserLabel,
              backendUrl,
              linkedKeks,
              runWithFreshSession,
              session,
              setApiUserLabel,
              setApiUserProgress,
              setApiUsers,
              setErrorMessage,
              setIsCreatingApiUser,
              setLatestApiToken,
              setStatusMessage,
            });
          }}
        >
          {isCreatingApiUser ? (
            <ActivityIndicator color={themeMode === 'dark' ? '#020617' : '#ffffff'} />
          ) : (
            <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
              Create API user
            </Text>
          )}
        </Pressable>
        <Pressable
          className={`items-center rounded-full border px-4 py-4 ${tokens.card}`}
          disabled={isLoadingApiUsers || isCreatingApiUser || !!apiUserProgress}
          onPress={refreshApiUsers}
        >
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.title}`}>
            Refresh
          </Text>
        </Pressable>
      </View>
      {latestApiToken ? <LatestApiTokenPanel latestApiToken={latestApiToken} /> : null}
      {apiUserProgress ? <ProvisionProgressPanel progress={apiUserProgress} /> : null}
    </View>
  );
}

function ApiUsersList({
  apiUserProgress,
  apiUsers,
  backendUrl,
  deletingApiUserId,
  isCreatingApiUser,
  isLoadingApiUsers,
  linkedKeks,
  runWithFreshSession,
  session,
  setApiUserProgress,
  setApiUsers,
  setDeletingApiUserId,
  setErrorMessage,
  setStatusMessage,
  tokens,
}: Readonly<{
  apiUserProgress: ProvisionProgress | null;
  apiUsers: ApiUserView[];
  backendUrl: string;
  deletingApiUserId: string | null;
  isCreatingApiUser: boolean;
  isLoadingApiUsers: boolean;
  linkedKeks: PersistedLinkedKek[];
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  session: AuthApiResponse | null;
  setApiUserProgress: NullableProgressSetter;
  setApiUsers: ApiUsersSetter;
  setDeletingApiUserId: Dispatch<SetStateAction<string | null>>;
  setErrorMessage: NullableStringSetter;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  tokens: (typeof themeTokens)['light'];
}>) {
  let content = (
    <View className={`rounded-[22px] border px-4 py-4 ${tokens.card}`}>
      <Text className={`text-sm ${tokens.body}`}>No API users created yet.</Text>
    </View>
  );

  if (isLoadingApiUsers) {
    content = (
      <View className={`items-center rounded-[22px] border px-4 py-8 ${tokens.card}`}>
        <ActivityIndicator color={tokens.kicker.includes('emerald') ? '#6ee7b7' : '#0f9d68'} />
      </View>
    );
  }

  if (!isLoadingApiUsers && apiUsers.length > 0) {
    content = (
      <>
        {apiUsers.map((apiUser) => (
          <ApiUserCard
            apiUser={apiUser}
            apiUserProgress={apiUserProgress}
            backendUrl={backendUrl}
            deletingApiUserId={deletingApiUserId}
            isCreatingApiUser={isCreatingApiUser}
            linkedKeks={linkedKeks}
            runWithFreshSession={runWithFreshSession}
            session={session}
            setApiUserProgress={setApiUserProgress}
            setApiUsers={setApiUsers}
            setDeletingApiUserId={setDeletingApiUserId}
            setErrorMessage={setErrorMessage}
            setStatusMessage={setStatusMessage}
            tokens={tokens}
            key={apiUser.id}
          />
        ))}
      </>
    );
  }

  return (
    <View className="gap-3">
      <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
        Managed API users
      </Text>
      {content}
    </View>
  );
}

function ApiUserCard({
  apiUser,
  apiUserProgress,
  backendUrl,
  deletingApiUserId,
  isCreatingApiUser,
  linkedKeks,
  runWithFreshSession,
  session,
  setApiUserProgress,
  setApiUsers,
  setDeletingApiUserId,
  setErrorMessage,
  setStatusMessage,
  tokens,
}: Readonly<{
  apiUser: ApiUserView;
  apiUserProgress: ProvisionProgress | null;
  backendUrl: string;
  deletingApiUserId: string | null;
  isCreatingApiUser: boolean;
  linkedKeks: PersistedLinkedKek[];
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  session: AuthApiResponse | null;
  setApiUserProgress: NullableProgressSetter;
  setApiUsers: ApiUsersSetter;
  setDeletingApiUserId: Dispatch<SetStateAction<string | null>>;
  setErrorMessage: NullableStringSetter;
  setStatusMessage: Dispatch<SetStateAction<string>>;
  tokens: (typeof themeTokens)['light'];
}>) {
  const progressWidth = buildProgressWidth(
    apiUser.provisioning.completedResourceCount,
    apiUser.provisioning.totalResourceCount,
  );
  const pendingProvisionMessage = buildPendingProvisionMessage(apiUser);
  const canResumeProvisioning = apiUser.provisioning.pendingResourceCount > 0;

  return (
    <View className={`gap-3 rounded-[22px] border px-4 py-4 ${tokens.card}`}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className={`text-base font-semibold ${tokens.title}`}>
            {apiUser.label || 'Unlabeled API user'}
          </Text>
          <Text className={`text-xs uppercase tracking-[1.5px] ${tokens.body}`} selectable>
            {apiUser.username}
          </Text>
        </View>
        <Text className={`text-xs font-semibold uppercase tracking-[1.5px] ${tokens.body}`}>
          {apiUser.provisioning.completedResourceCount}/{apiUser.provisioning.totalResourceCount}
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-slate-800">
        <View className="h-full rounded-full bg-emerald-500" style={{ width: progressWidth }} />
      </View>
      <Text className={`text-sm ${tokens.body}`}>{pendingProvisionMessage}</Text>
      <Text className={`text-xs ${tokens.body}`}>Created {formatTimestamp(apiUser.createdAt)}</Text>
      <Text className={`text-xs ${tokens.body}`}>Updated {formatTimestamp(apiUser.updatedAt)}</Text>
      <View className="flex-row gap-3">
        {canResumeProvisioning ? (
          <Pressable
            className={`flex-1 items-center rounded-full border px-4 py-3 ${tokens.card}`}
            disabled={!!apiUserProgress || isCreatingApiUser || deletingApiUserId === apiUser.id}
            onPress={() => {
              void handleResumeApiUser({
                apiUserId: apiUser.id,
                backendUrl,
                linkedKeks,
                runWithFreshSession,
                session,
                setApiUserProgress,
                setApiUsers,
                setErrorMessage,
                setStatusMessage,
              });
            }}
          >
            <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.title}`}>
              Resume provisioning
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          className="items-center rounded-full border border-rose-300 px-4 py-3 dark:border-rose-900"
          disabled={deletingApiUserId === apiUser.id || !!apiUserProgress || isCreatingApiUser}
          onPress={() => {
            void handleDeleteApiUser({
              apiUser,
              backendUrl,
              runWithFreshSession,
              session,
              setApiUsers,
              setDeletingApiUserId,
              setErrorMessage,
              setStatusMessage,
            });
          }}
        >
          <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-rose-700 dark:text-rose-200">
            {deletingApiUserId === apiUser.id ? 'Removing...' : 'Remove'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function UnavailableCard({
  bodyClassName,
  cardClassName,
  kickerClassName,
}: Readonly<{
  bodyClassName: string;
  cardClassName: string;
  kickerClassName: string;
}>) {
  return (
    <View className={`gap-3 rounded-[22px] border px-4 py-4 ${cardClassName}`}>
      <Text className={`text-sm uppercase tracking-[2px] ${kickerClassName}`}>Unavailable</Text>
      <Text className={`text-sm ${bodyClassName}`}>
        API user management is only available when you are signed in with the owner account.
      </Text>
    </View>
  );
}

function LatestApiTokenPanel({ latestApiToken }: Readonly<{ latestApiToken: string }>) {
  return (
    <View className="rounded-[18px] border border-emerald-300 bg-emerald-50 px-4 py-4 dark:border-emerald-900 dark:bg-emerald-950/30">
      <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-emerald-900 dark:text-emerald-200">
        Latest API token
      </Text>
      <Text className="mt-2 text-xs text-emerald-900 dark:text-emerald-100" selectable>
        {latestApiToken}
      </Text>
    </View>
  );
}

function ProvisionProgressPanel({ progress }: Readonly<{ progress: ProvisionProgress }>) {
  return (
    <View className="gap-2 rounded-[18px] border border-sky-300 bg-sky-50 px-4 py-4 dark:border-sky-900 dark:bg-sky-950/30">
      <Text className="text-sm font-semibold text-sky-900 dark:text-sky-200">
        Provisioning {progress.username}
      </Text>
      <View className="h-3 overflow-hidden rounded-full bg-sky-100 dark:bg-sky-950">
        <View
          className="h-full rounded-full bg-sky-500"
          style={{ width: buildProgressWidth(progress.completed, progress.total) }}
        />
      </View>
      <Text className="text-sm text-sky-900/80 dark:text-sky-200/80">
        Provisioned {progress.completed} of {progress.total} resources.
      </Text>
    </View>
  );
}

async function loadApiUsers({
  backendUrl,
  linkedKeks,
  runWithFreshSession,
  setApiUsers,
  setErrorMessage,
  setIsLoadingApiUsers,
}: {
  backendUrl: string;
  linkedKeks: PersistedLinkedKek[];
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  setApiUsers: (apiUsers: ApiUserView[]) => void;
  setErrorMessage: (message: string | null) => void;
  setIsLoadingApiUsers: (value: boolean) => void;
}) {
  setErrorMessage(null);
  setIsLoadingApiUsers(true);

  try {
    const remoteApiUsers = await runWithFreshSession((activeSession) =>
      fetchApiUsers({
        baseUrl: backendUrl.trim(),
        token: activeSession.token,
      }),
    );

    const decryptedApiUsers = await Promise.all(
      remoteApiUsers.map((apiUser) => decryptApiUserRecord(apiUser, linkedKeks)),
    );

    setApiUsers(decryptedApiUsers);
  } catch (error) {
    setApiUsers([]);
    setErrorMessage(error instanceof Error ? error.message : 'Unable to load API users.');
  } finally {
    setIsLoadingApiUsers(false);
  }
}

async function handleCreateApiUser({
  apiUserLabel,
  backendUrl,
  linkedKeks,
  runWithFreshSession,
  session,
  setApiUserLabel,
  setApiUserProgress,
  setApiUsers,
  setErrorMessage,
  setIsCreatingApiUser,
  setLatestApiToken,
  setStatusMessage,
}: {
  apiUserLabel: string;
  backendUrl: string;
  linkedKeks: PersistedLinkedKek[];
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  session: AuthApiResponse | null;
  setApiUserLabel: Dispatch<SetStateAction<string>>;
  setApiUserProgress: NullableProgressSetter;
  setApiUsers: ApiUsersSetter;
  setErrorMessage: NullableStringSetter;
  setIsCreatingApiUser: Dispatch<SetStateAction<boolean>>;
  setLatestApiToken: Dispatch<SetStateAction<string | null>>;
  setStatusMessage: Dispatch<SetStateAction<string>>;
}) {
  if (session?.currentPrincipal.kind !== 'user') {
    return;
  }

  setErrorMessage(null);
  setStatusMessage('');
  setIsCreatingApiUser(true);

  try {
    const trimmedBackendUrl = backendUrl.trim();
    const currentLinkedPrincipals = await runWithFreshSession((activeSession) =>
      fetchLinkedPrincipals({
        baseUrl: trimmedBackendUrl,
        token: activeSession.token,
      }),
    );
    const ownerPrincipal = currentLinkedPrincipals.find((principal) => principal.id === session.user.id);

    if (!ownerPrincipal) {
      throw new Error('The backend did not return the owner KEK metadata.');
    }

    const { createApiToken, deriveApiTokenCredentials, encryptStringWithAsymmetricKeks } =
      await getNativeAuthModule();
    const apiUserId = Crypto.randomUUID();
    const apiToken = await createApiToken();
    const apiTokenCredentials = await deriveApiTokenCredentials(apiToken);
    const encryptedLabel = await encryptStringWithAsymmetricKeks(apiUserLabel.trim(), [
      ownerPrincipal.latestKekPublicKey,
      apiTokenCredentials.kekKeyPair.kekPublicKey,
    ]);
    const createdApiUser = await runWithFreshSession((activeSession) =>
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
    await continueApiUserProvisioning({
      apiUser: createdApiUser,
      backendUrl: trimmedBackendUrl,
      linkedKeks,
      runWithFreshSession,
      setApiUserProgress,
      setApiUsers,
      setErrorMessage,
      setStatusMessage,
    });
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : 'Unable to create the API user.');
  } finally {
    setIsCreatingApiUser(false);
  }
}

async function handleResumeApiUser({
  apiUserId,
  backendUrl,
  linkedKeks,
  runWithFreshSession,
  session,
  setApiUserProgress,
  setApiUsers,
  setErrorMessage,
  setStatusMessage,
}: {
  apiUserId: string;
  backendUrl: string;
  linkedKeks: PersistedLinkedKek[];
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  session: AuthApiResponse | null;
  setApiUserProgress: NullableProgressSetter;
  setApiUsers: ApiUsersSetter;
  setErrorMessage: NullableStringSetter;
  setStatusMessage: Dispatch<SetStateAction<string>>;
}) {
  if (session?.currentPrincipal.kind !== 'user') {
    return;
  }

  setErrorMessage(null);
  setStatusMessage('');

  try {
    const apiUser = await runWithFreshSession((activeSession) =>
      fetchApiUser({
        apiUserId,
        baseUrl: backendUrl.trim(),
        token: activeSession.token,
      }),
    );

    await continueApiUserProvisioning({
      apiUser,
      backendUrl: backendUrl.trim(),
      linkedKeks,
      runWithFreshSession,
      setApiUserProgress,
      setApiUsers,
      setErrorMessage,
      setStatusMessage,
    });
  } catch (error) {
    setErrorMessage(
      error instanceof Error ? error.message : 'Unable to resume API user provisioning.',
    );
  }
}

async function handleDeleteApiUser({
  apiUser,
  backendUrl,
  runWithFreshSession,
  session,
  setApiUsers,
  setDeletingApiUserId,
  setErrorMessage,
  setStatusMessage,
}: {
  apiUser: ApiUserView;
  backendUrl: string;
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  session: AuthApiResponse | null;
  setApiUsers: ApiUsersSetter;
  setDeletingApiUserId: Dispatch<SetStateAction<string | null>>;
  setErrorMessage: NullableStringSetter;
  setStatusMessage: Dispatch<SetStateAction<string>>;
}) {
  if (session?.currentPrincipal.kind !== 'user') {
    return;
  }

  const confirmed = await confirmDeleteApiUser(apiUser.username);

  if (!confirmed) {
    return;
  }

  setErrorMessage(null);
  setStatusMessage('');
  setDeletingApiUserId(apiUser.id);

  try {
    await runWithFreshSession((activeSession) =>
      deleteApiUserRequest({
        apiUserId: apiUser.id,
        baseUrl: backendUrl.trim(),
        token: activeSession.token,
      }),
    );

    setApiUsers((currentApiUsers) => currentApiUsers.filter((entry) => entry.id !== apiUser.id));
    setStatusMessage(`Removed API user ${apiUser.username} and its linked key material.`);
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : 'Unable to delete the API user.');
  } finally {
    setDeletingApiUserId(null);
  }
}

async function continueApiUserProvisioning({
  apiUser,
  backendUrl,
  linkedKeks,
  runWithFreshSession,
  setApiUserProgress,
  setApiUsers,
  setErrorMessage,
  setStatusMessage,
}: {
  apiUser: ApiUserResponse;
  backendUrl: string;
  linkedKeks: PersistedLinkedKek[];
  runWithFreshSession: <T>(callback: (session: AuthApiResponse) => Promise<T>) => Promise<T>;
  setApiUserProgress: NullableProgressSetter;
  setApiUsers: ApiUsersSetter;
  setErrorMessage: NullableStringSetter;
  setStatusMessage: Dispatch<SetStateAction<string>>;
}) {
  const remoteNotes = await runWithFreshSession((activeSession) =>
    fetchNotes({
      baseUrl: backendUrl,
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
    const { rewrapAsymmetricEncryptedDek } = await getNativeAuthModule();

    for (const noteId of apiUser.provisioning.pendingNoteIds) {
      const note = notesById.get(noteId);

      if (!note) {
        throw new Error('A note required for API user provisioning is missing from the backend.');
      }

      const noteLinkedKek = findLinkedKek(linkedKeks, note.encryptedDek.kekPublicKey);

      if (!noteLinkedKek) {
        throw new Error(
          `Missing the local KEK for epoch-linked id ${note.encryptedDek.kekPublicKey}. Log in again and provide the older password for that KEK.`,
        );
      }

      const wrappedDek = await rewrapAsymmetricEncryptedDek(
        note,
        noteLinkedKek.cryptKey,
        latestApiUser.latestKekPublicKey,
      );

      latestApiUser = await runWithFreshSession((activeSession) =>
        provisionApiUserDeksRequest({
          apiUserId: apiUser.id,
          baseUrl: backendUrl,
          token: activeSession.token,
          wrappedDeks: [
            {
              resourceId: note.id,
              wrappedDek: {
                ...wrappedDek,
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
      backendUrl,
      linkedKeks,
      runWithFreshSession,
      setApiUsers,
      setErrorMessage,
      setIsLoadingApiUsers: () => undefined,
    });

    const provisioningMessage = latestApiUser.provisioning.pendingResourceCount === 0
      ? `Provisioned API user ${latestApiUser.username}.`
      : `Provisioning for API user ${latestApiUser.username} is still pending.`;

    setStatusMessage(provisioningMessage);
  } finally {
    setApiUserProgress(null);
  }
}

function findLinkedKek(linkedKeks: PersistedLinkedKek[], kekPublicKey: string) {
  return linkedKeks.find((linkedKek) => linkedKek.kekPublicKey === kekPublicKey) ?? null;
}

async function decryptApiUserRecord(
  apiUser: ApiUserResponse,
  linkedKeks: PersistedLinkedKek[],
): Promise<ApiUserView> {
  const linkedKek = findLinkedKek(linkedKeks, apiUser.encryptedLabelDek.kekPublicKey);

  if (!linkedKek) {
    throw new Error(
      `Missing the local KEK for API user label ${apiUser.encryptedLabelDek.kekPublicKey}.`,
    );
  }

  const { decryptStringWithAsymmetricKek } = await getNativeAuthModule();

  return {
    ...apiUser,
    label: await decryptStringWithAsymmetricKek(
      {
        encryptedDek: apiUser.encryptedLabelDek,
        encryptedPayload: apiUser.encryptedLabel,
      },
      linkedKek.cryptKey,
    ),
  };
}

function confirmDeleteApiUser(username: string) {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Remove API user',
      `Remove API user ${username}? This also deletes its linked KEK and DEK entries.`,
      [
        {
          style: 'cancel',
          text: 'Cancel',
          onPress: () => resolve(false),
        },
        {
          style: 'destructive',
          text: 'Remove API user',
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

function buildProgressWidth(completed: number, total: number): DimensionValue {
  if (total === 0) {
    return '100%';
  }

  return `${(completed / total) * 100}%`;
}

function buildPendingProvisionMessage(apiUser: ApiUserView) {
  if (apiUser.provisioning.pendingResourceCount === 0) {
    return 'Provisioning complete.';
  }

  const wrapLabel = apiUser.provisioning.pendingResourceCount === 1 ? 'wrap' : 'wraps';
  return `${apiUser.provisioning.pendingResourceCount} resource ${wrapLabel} still pending.`;
}

function formatTimestamp(value: string) {
  const parsedTimestamp = Date.parse(value);

  if (Number.isNaN(parsedTimestamp)) {
    return value;
  }

  return new Date(parsedTimestamp).toLocaleString();
}