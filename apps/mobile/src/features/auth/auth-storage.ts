import * as SecureStore from 'expo-secure-store';

import type { CryptKey } from '@repo/e2ee-auth/native';

import { isAuthApiResponse, type AuthApiResponse } from './auth-api';

const AUTH_PREFERENCES_STORAGE_KEY = 'auth-preferences';

export type AuthPreferences = {
  backendUrl: string;
  email?: string;
  lastEmail: string;
  linkedKeks?: PersistedLinkedKek[];
  session?: AuthApiResponse;
};

export type PersistedLinkedKek = {
  cryptKey: CryptKey;
  kekEpochVersion: number;
  kekPublicKey: string;
  saltHex: string;
};

const runtimeBackendUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

const defaultPreferences: AuthPreferences = {
  backendUrl: runtimeBackendUrl ?? '',
  lastEmail: '',
};

export interface AuthPreferencesPersistence {
  read: () => Promise<AuthPreferences>;
  write: (preferences: AuthPreferences) => Promise<void>;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string) {
  const normalizedHex = hex.trim().toLowerCase();

  if (!normalizedHex || normalizedHex.length % 2 !== 0 || /[^0-9a-f]/.test(normalizedHex)) {
    return null;
  }

  const bytes = new Uint8Array(normalizedHex.length / 2);

  for (let index = 0; index < normalizedHex.length; index += 2) {
    const nextByte = Number.parseInt(normalizedHex.slice(index, index + 2), 16);

    if (Number.isNaN(nextByte)) {
      return null;
    }

    bytes[index / 2] = nextByte;
  }

  return bytes;
}

export const secureStoreAuthPreferences: AuthPreferencesPersistence = {
  async read() {
    try {
      const storedPreferences = await SecureStore.getItemAsync(
        AUTH_PREFERENCES_STORAGE_KEY,
      );

      if (!storedPreferences) {
        return defaultPreferences;
      }

      const parsedPreferences = JSON.parse(storedPreferences) as Partial<AuthPreferences>;
      const linkedKeks: PersistedLinkedKek[] = [];

      if (Array.isArray(parsedPreferences.linkedKeks)) {
        for (const linkedKek of parsedPreferences.linkedKeks) {
          const cryptKeyHex = typeof linkedKek?.cryptKey === 'string' ? linkedKek.cryptKey : '';
          const cryptKey = hexToBytes(cryptKeyHex);

          if (
            !cryptKey ||
            typeof linkedKek?.kekEpochVersion !== 'number' ||
            typeof linkedKek?.kekPublicKey !== 'string' ||
            typeof linkedKek?.saltHex !== 'string'
          ) {
            continue;
          }

          linkedKeks.push({
            cryptKey,
            kekEpochVersion: linkedKek.kekEpochVersion,
            kekPublicKey: linkedKek.kekPublicKey.trim(),
            saltHex: linkedKek.saltHex.trim().toLowerCase(),
          });
        }
      }

      return {
        backendUrl: runtimeBackendUrl || parsedPreferences.backendUrl?.trim() || defaultPreferences.backendUrl,
        email: typeof parsedPreferences.email === 'string'
          ? parsedPreferences.email.trim().toLowerCase()
          : undefined,
        lastEmail: parsedPreferences.lastEmail ?? '',
        linkedKeks,
        session: isAuthApiResponse(parsedPreferences.session)
          ? normalizeStoredSession(parsedPreferences.session)
          : undefined,
      };
    } catch {
      return defaultPreferences;
    }
  },
  async write(preferences) {
    try {
      const storedLinkedKeks = (preferences.linkedKeks ?? []).map((linkedKek) => ({
        cryptKey: bytesToHex(linkedKek.cryptKey),
        kekEpochVersion: linkedKek.kekEpochVersion,
        kekPublicKey: linkedKek.kekPublicKey.trim(),
        saltHex: linkedKek.saltHex.trim().toLowerCase(),
      }));

      await SecureStore.setItemAsync(
        AUTH_PREFERENCES_STORAGE_KEY,
        JSON.stringify({
          ...preferences,
          email: preferences.email?.trim().toLowerCase(),
          lastEmail: preferences.lastEmail.trim().toLowerCase(),
          linkedKeks: storedLinkedKeks,
          session: preferences.session ? normalizeStoredSession(preferences.session) : undefined,
        }),
      );
    } catch {
      // Keep auth usable even when persistence is unavailable.
    }
  },
};

function normalizeStoredSession(session: AuthApiResponse): AuthApiResponse {
  return {
    currentPrincipal: {
      email: session.currentPrincipal.email?.trim().toLowerCase() ?? null,
      id: session.currentPrincipal.id.trim(),
      kind: session.currentPrincipal.kind,
      username: session.currentPrincipal.username?.trim() ?? null,
    },
    kekMetadatas: session.kekMetadatas.map((metadata) => ({
      kekEpochVersion: metadata.kekEpochVersion,
      kekPublicKey: metadata.kekPublicKey.trim(),
    })),
    linkedPrincipals: session.linkedPrincipals.map((principal) => ({
      email: principal.email?.trim().toLowerCase() ?? null,
      id: principal.id.trim(),
      kind: principal.kind,
      latestKekEpochVersion: principal.latestKekEpochVersion,
      latestKekPublicKey: principal.latestKekPublicKey.trim(),
      username: principal.username?.trim() ?? null,
    })),
    refreshToken: session.refreshToken.trim(),
    token: session.token.trim(),
    user: {
      email: session.user.email.trim().toLowerCase(),
      id: session.user.id.trim(),
    },
  };
}
