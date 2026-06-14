import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  deleteAccountRequest,
  fetchPasswordSalt,
  fetchKekMigrationStatus,
  loginRequest,
  refreshSessionRequest,
  rotatePasswordRequest,
  registerRequest,
  type AuthApiResponse,
  type KekMigrationStatusResponse,
  type KekMetadata,
} from './auth-api';
import {
  secureStoreAuthPreferences,
  type AuthPreferences,
  type PersistedLinkedKek,
} from './auth-storage';
import { getNativeAuthModule } from '../e2ee/native-runtime';

type Session = AuthApiResponse;

type AuthContextValue = {
  activeKekId: string | null;
  backendUrl: string;
  deleteAccount: () => Promise<void>;
  isAuthenticated: boolean;
  isHydrated: boolean;
  kekMigrationStatus: KekMigrationStatusResponse | null;
  lastEmail: string;
  linkedKeks: PersistedLinkedKek[];
  login: (email: string, password: string, olderPasswords?: Record<string, string>) => Promise<void>;
  pendingOlderKeks: KekMetadata[];
  persistLinkedKeks: (linkedKeks: PersistedLinkedKek[]) => Promise<void>;
  refreshKekMigrationStatus: () => Promise<KekMigrationStatusResponse | null>;
  register: (email: string, password: string) => Promise<void>;
  runWithFreshSession: <T>(callback: (session: Session) => Promise<T>) => Promise<T>;
  rotatePassword: (newPassword: string) => Promise<{
    activeKekId: string;
    linkedKeks: PersistedLinkedKek[];
    session: Session;
  }>;
  session: Session | null;
  signOut: () => Promise<void>;
  updateBackendUrl: (backendUrl: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = Readonly<{
  children: ReactNode;
}>;

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown authentication error.';
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.stack ? `${error.name}: ${error.message}\n${error.stack}` : `${error.name}: ${error.message}`;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unserializable thrown value.';
  }
}

function logAuthStageError(stage: string, error: unknown) {
  console.error(`[auth] ${stage}: ${describeError(error)}`);
}

async function runAuthStage<TResult>(stage: string, operation: () => Promise<TResult>) {
  console.log(`[auth] ${stage}: start`);

  try {
    const result = await operation();

    console.log(`[auth] ${stage}: ok`);

    return result;
  } catch (error) {
    logAuthStageError(stage, error);
    throw error;
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [preferences, setPreferences] = useState<AuthPreferences>({
    backendUrl: '',
    email: undefined,
    lastEmail: '',
    linkedKeks: [],
  });
  const [session, setSession] = useState<Session | null>(null);
  const [activeKekId, setActiveKekId] = useState<string | null>(null);
  const [kekMigrationStatus, setKekMigrationStatus] = useState<KekMigrationStatusResponse | null>(null);
  const [pendingOlderKeks, setPendingOlderKeks] = useState<KekMetadata[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  const applySessionState = useCallback((nextSession: Session | null) => {
    const sortedKekMetadatas = nextSession ? sortKekMetadatas(nextSession.kekMetadatas) : [];

    setSession(nextSession);
    setActiveKekId(sortedKekMetadatas[0]?.kekPublicKey ?? null);
    setPendingOlderKeks(sortedKekMetadatas.slice(1));
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function hydrateAuthPreferences() {
      const storedPreferences = await secureStoreAuthPreferences.read();

      if (!isMounted) {
        return;
      }

      applySessionState(storedPreferences.session ?? null);
      setPreferences(storedPreferences);
      setIsHydrated(true);
    }

    void hydrateAuthPreferences();

    return () => {
      isMounted = false;
    };
  }, [applySessionState]);

  const persistPreferences = useCallback(async (nextPreferences: AuthPreferences) => {
    setPreferences(nextPreferences);
    await secureStoreAuthPreferences.write(nextPreferences);
  }, []);

  const persistAuthenticatedState = useCallback(async (
    nextSession: Session,
    nextPreferences: AuthPreferences,
  ) => {
    applySessionState(nextSession);
    await persistPreferences({
      ...nextPreferences,
      session: nextSession,
    });
  }, [applySessionState, persistPreferences]);

  const persistSignedOutState = useCallback(async (nextPreferences: AuthPreferences) => {
    applySessionState(null);
    setKekMigrationStatus(null);
    await persistPreferences({
      ...nextPreferences,
      session: undefined,
    });
  }, [applySessionState, persistPreferences]);

  const authenticate = useCallback(async (
    mode: 'login' | 'register',
    email: string,
    password: string,
    olderPasswords: Record<string, string> = {},
  ) => {
    console.log(`[auth] authenticate: start (${mode})`);

    const nativeAuthModule = await runAuthStage('load native auth module', async () => {
      try {
        return await getNativeAuthModule();
      } catch (error) {
        throw new Error(`Failed to load native auth module: ${toErrorMessage(error)}`, {
          cause: error,
        });
      }
    });
    const { createPasswordSalt, deriveCredentials, deriveKekKeyPair } = nativeAuthModule;
    const backendUrl = preferences.backendUrl.trim();
    const normalizedEmail = normalizeEmail(email);
    const persistedLinkedKeks =
      preferences.email === normalizedEmail ? preferences.linkedKeks ?? [] : [];

    if (!backendUrl) {
      throw new Error('Enter the backend URL before continuing.');
    }

    let saltMaterial: {
      kekMetadatas: KekMetadata[];
      saltHex: string;
    };

    if (mode === 'login') {
      saltMaterial = await runAuthStage('fetch password salt', async () => {
        try {
          return await fetchPasswordSalt({
            baseUrl: backendUrl,
            email: normalizedEmail,
          });
        } catch (error) {
          throw new Error(`Failed to fetch the password salt: ${toErrorMessage(error)}`, {
            cause: error,
          });
        }
      });
    } else {
      const saltHex = await runAuthStage('create password salt', async () => {
        try {
          return await createPasswordSalt();
        } catch (error) {
          throw new Error(`Failed to create the password salt: ${toErrorMessage(error)}`, {
            cause: error,
          });
        }
      });

      saltMaterial = {
        kekMetadatas: [],
        saltHex,
      };
    }

    logSaltMaterial(saltMaterial);
    assertSaltMaterial(saltMaterial);

    const sortedKekMetadatas = sortKekMetadatas(saltMaterial.kekMetadatas);
    const missingOlderKeks =
      mode === 'login'
        ? sortedKekMetadatas.slice(1).filter(
            (metadata) =>
              !findLinkedKek(persistedLinkedKeks, metadata.kekPublicKey) &&
              !olderPasswords[metadata.kekPublicKey]?.trim(),
          )
        : [];

    setPendingOlderKeks(sortedKekMetadatas.slice(1));

    if (missingOlderKeks.length > 0) {
      throw new Error('Enter the passwords for the older active KEKs before logging in.');
    }

    const saltHex = saltMaterial.saltHex;
    const credentials = await runAuthStage('derive credentials', async () => {
      try {
        return await deriveCredentials(normalizedEmail, password, saltHex);
      } catch (error) {
        throw new Error(`Failed to derive credentials: ${toErrorMessage(error)}`, {
          cause: error,
        });
      }
    });
    const registerKekKeyPair =
      mode === 'register'
        ? await runAuthStage('derive KEK key pair', async () => {
            try {
              return await deriveKekKeyPair(credentials.cryptKey);
            } catch (error) {
              throw new Error(
                `Failed to derive the KEK key pair: ${toErrorMessage(error)}`,
                {
                  cause: error,
                },
              );
            }
          })
        : null;
    const response =
      mode === 'login'
        ? await runAuthStage('login request', async () => {
            try {
              return await loginRequest({
                authKey: credentials.authKey,
                baseUrl: backendUrl,
                email: credentials.email,
              });
            } catch (error) {
              throw new Error(`Login request failed: ${toErrorMessage(error)}`, {
                cause: error,
              });
            }
          })
        : await runAuthStage('register request', async () => {
            try {
              return await registerRequest({
                authKey: credentials.authKey,
                baseUrl: backendUrl,
                email: credentials.email,
                kekPublicKey: registerKekKeyPair!.kekPublicKey,
                saltHex,
              });
            } catch (error) {
              throw new Error(`Register request failed: ${toErrorMessage(error)}`, {
                cause: error,
              });
            }
          });
    const responseKekMetadatas = sortKekMetadatas(response.kekMetadatas);
    const latestKekMetadata = responseKekMetadatas[0];

    if (!latestKekMetadata) {
      throw new Error('The backend did not return KEK metadata.');
    }

    const retainedLinkedKeks = persistedLinkedKeks.filter((linkedKek) =>
      responseKekMetadatas.some((metadata) => metadata.kekPublicKey === linkedKek.kekPublicKey),
    );
    const nextDerivedLinkedKeks: PersistedLinkedKek[] = [
      {
        cryptKey: credentials.cryptKey,
        kekEpochVersion: latestKekMetadata.kekEpochVersion,
        kekPublicKey: latestKekMetadata.kekPublicKey,
        saltHex,
      },
    ];

    for (const metadata of responseKekMetadatas.slice(1)) {
      if (findLinkedKek(retainedLinkedKeks, metadata.kekPublicKey)) {
        continue;
      }

      const olderPassword = olderPasswords[metadata.kekPublicKey]?.trim();

      if (!olderPassword) {
        continue;
      }

      const olderCredentials = await deriveCredentials(normalizedEmail, olderPassword, saltHex);

      nextDerivedLinkedKeks.push({
        cryptKey: olderCredentials.cryptKey,
        kekEpochVersion: metadata.kekEpochVersion,
        kekPublicKey: metadata.kekPublicKey,
        saltHex,
      });
    }

    const nextLinkedKeks = mergeLinkedKeks([
      ...retainedLinkedKeks,
      ...nextDerivedLinkedKeks,
    ]);

    await runAuthStage('persist authenticated session', async () => {
      try {
        await persistAuthenticatedState(response, {
          backendUrl,
          email: credentials.email,
          lastEmail: credentials.email,
          linkedKeks: nextLinkedKeks,
        });
      } catch (error) {
        throw new Error(
          `Failed to persist the authenticated session: ${toErrorMessage(error)}`,
          {
            cause: error,
          },
        );
      }
    });
  }, [persistAuthenticatedState, preferences]);

  const updateBackendUrl = useCallback(async (backendUrl: string) => {
    await persistPreferences({
      ...preferences,
      backendUrl: backendUrl.trim(),
    });
  }, [persistPreferences, preferences]);

  const persistLinkedKeks = useCallback(async (linkedKeks: PersistedLinkedKek[]) => {
    await persistPreferences({
      ...preferences,
      linkedKeks,
    });
  }, [persistPreferences, preferences]);

  const refreshSession = useCallback(async (currentSession: Session) => {
    const nextSession = await refreshSessionRequest({
      baseUrl: preferences.backendUrl,
      refreshToken: currentSession.refreshToken,
    });

    await persistAuthenticatedState(nextSession, {
      ...preferences,
      email: nextSession.user.email,
      lastEmail: nextSession.user.email,
      linkedKeks: preferences.linkedKeks ?? [],
    });

    return nextSession;
  }, [persistAuthenticatedState, preferences]);

  const runWithFreshSession = useCallback(async <T,>(
    callback: (currentSession: Session) => Promise<T>,
  ) => {
    if (!session) {
      throw new Error('Log in before continuing.');
    }

    try {
      return await callback(session);
    } catch (error) {
      if (!hasUnauthorizedStatus(error)) {
        throw error;
      }

      try {
        const refreshedSession = await refreshSession(session);
        return await callback(refreshedSession);
      } catch (refreshError) {
        if (hasUnauthorizedStatus(refreshError)) {
          await persistSignedOutState({
            ...preferences,
          });
        }

        throw refreshError;
      }
    }
  }, [persistSignedOutState, preferences, refreshSession, session]);

  const refreshKekMigrationStatus = useCallback(async () => {
    if (!session) {
      setKekMigrationStatus(null);
      return null;
    }

    const nextStatus = await runWithFreshSession((currentSession) =>
      fetchKekMigrationStatus({
        baseUrl: preferences.backendUrl,
        token: currentSession.token,
      }));

    setKekMigrationStatus(nextStatus);

    return nextStatus;
  }, [preferences.backendUrl, runWithFreshSession, session]);

  const rotatePassword = useCallback(async (newPassword: string) => {
    if (!session) {
      throw new Error('Log in before rotating the password.');
    }

    const { deriveCredentials, deriveKekKeyPair } = await getNativeAuthModule();

    const saltHex = preferences.linkedKeks?.[0]?.saltHex;

    if (!saltHex) {
      throw new Error('The current password salt is missing from local storage. Log in again.');
    }

    const credentials = await deriveCredentials(session.user.email, newPassword, saltHex);
    const kekKeyPair = await deriveKekKeyPair(credentials.cryptKey);
    const response = await runWithFreshSession((currentSession) =>
      rotatePasswordRequest({
        baseUrl: preferences.backendUrl,
        kekPublicKey: kekKeyPair.kekPublicKey,
        newAuthKey: credentials.authKey,
        token: currentSession.token,
      }));
    const latestKekMetadata = sortKekMetadatas(response.kekMetadatas)[0];

    if (!latestKekMetadata) {
      throw new Error('The backend did not return KEK metadata.');
    }

    const nextLinkedKeks = mergeLinkedKeks([
      ...(preferences.linkedKeks ?? []),
      {
        cryptKey: credentials.cryptKey,
        kekEpochVersion: latestKekMetadata.kekEpochVersion,
        kekPublicKey: latestKekMetadata.kekPublicKey,
        saltHex,
      },
    ]);

    await persistAuthenticatedState(response, {
      ...preferences,
      email: session.user.email,
      linkedKeks: nextLinkedKeks,
      lastEmail: session.user.email,
    });
    setKekMigrationStatus(null);

    return {
      activeKekId: latestKekMetadata.kekPublicKey,
      linkedKeks: nextLinkedKeks,
      session: response,
    };
  }, [persistAuthenticatedState, preferences, runWithFreshSession, session]);

  const signOut = useCallback(async () => {
    await persistSignedOutState({
      ...preferences,
    });
  }, [persistSignedOutState, preferences]);

  const deleteAccount = useCallback(async () => {
    if (!session) {
      throw new Error('Log in before deleting the account.');
    }

    await runWithFreshSession((currentSession) =>
      deleteAccountRequest({
        baseUrl: preferences.backendUrl,
        token: currentSession.token,
      }));

    await persistSignedOutState({
      ...preferences,
      email: undefined,
      linkedKeks: [],
    });
  }, [persistSignedOutState, preferences, runWithFreshSession, session]);

  const login = useCallback(
    (email: string, password: string, olderPasswords?: Record<string, string>) =>
      authenticate('login', email, password, olderPasswords),
    [authenticate],
  );

  const register = useCallback(
    (email: string, password: string) => authenticate('register', email, password),
    [authenticate],
  );

  const authContextValue = useMemo(
    () => ({
      activeKekId,
      backendUrl: preferences.backendUrl,
      deleteAccount,
      isAuthenticated: session !== null && activeKekId !== null,
      isHydrated,
      kekMigrationStatus,
      lastEmail: preferences.lastEmail,
      linkedKeks: preferences.linkedKeks ?? [],
      login,
      pendingOlderKeks,
      persistLinkedKeks,
      refreshKekMigrationStatus,
      register,
      runWithFreshSession,
      rotatePassword,
      session,
      signOut,
      updateBackendUrl,
    }),
    [
      activeKekId,
      deleteAccount,
      isHydrated,
      kekMigrationStatus,
      login,
      pendingOlderKeks,
      persistLinkedKeks,
      preferences.backendUrl,
      preferences.lastEmail,
      preferences.linkedKeks,
      refreshKekMigrationStatus,
      register,
      runWithFreshSession,
      rotatePassword,
      session,
      signOut,
      updateBackendUrl,
    ],
  );

  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
    </AuthContext.Provider>
  );
}

function sortKekMetadatas(kekMetadatas: KekMetadata[]) {
  if (!Array.isArray(kekMetadatas)) {
    throw new TypeError('Expected KEK metadata to be an array.');
  }

  return [...kekMetadatas].sort(
    (left, right) => right.kekEpochVersion - left.kekEpochVersion,
  );
}

function logSaltMaterial(saltMaterial: {
  kekMetadatas: KekMetadata[] | undefined;
  saltHex: string | undefined;
}) {
  console.log(
    `[auth] salt material: kekMetadatas=${Array.isArray(saltMaterial.kekMetadatas) ? saltMaterial.kekMetadatas.length : 'invalid'} saltHexType=${typeof saltMaterial.saltHex}`,
  );
}

function assertSaltMaterial(saltMaterial: {
  kekMetadatas: KekMetadata[] | undefined;
  saltHex: string | undefined;
}): asserts saltMaterial is {
  kekMetadatas: KekMetadata[];
  saltHex: string;
} {
  if (!Array.isArray(saltMaterial.kekMetadatas)) {
    throw new TypeError('The password salt material is missing a KEK metadata array.');
  }

  if (typeof saltMaterial.saltHex !== 'string') {
    throw new TypeError('The password salt material is missing a salt hex string.');
  }
}

function findLinkedKek(linkedKeks: PersistedLinkedKek[], kekPublicKey: string) {
  return linkedKeks.find((linkedKek) => linkedKek.kekPublicKey === kekPublicKey) ?? null;
}

function mergeLinkedKeks(linkedKeks: PersistedLinkedKek[]) {
  const entriesByKekPublicKey = new Map<string, PersistedLinkedKek>();

  for (const linkedKek of linkedKeks) {
    entriesByKekPublicKey.set(linkedKek.kekPublicKey, linkedKek);
  }

  return [...entriesByKekPublicKey.values()].sort(
    (left, right) => right.kekEpochVersion - left.kekEpochVersion,
  );
}

function hasUnauthorizedStatus(error: unknown) {
  return !!error &&
    typeof error === 'object' &&
    'status' in error &&
    error.status === 401;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function useAuth() {
  const authContext = useContext(AuthContext);

  if (!authContext) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return authContext;
}
