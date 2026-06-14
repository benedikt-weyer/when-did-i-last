import { sha512 } from '@noble/hashes/sha2.js';
import { createNativeOqsKekAdapter } from '@repo/oqs-kek/native';
import {
  crypto_pwhash,
  crypto_pwhash_ALG_ARGON2ID13,
  crypto_pwhash_MEMLIMIT_INTERACTIVE,
  crypto_pwhash_OPSLIMIT_INTERACTIVE,
  crypto_pwhash_SALTBYTES,
  crypto_secretbox_easy,
  crypto_secretbox_KEYBYTES,
  crypto_secretbox_NONCEBYTES,
  crypto_secretbox_open_easy,
  randombytes_buf,
  ready,
} from 'react-native-libsodium';

import { createE2ee } from './core';

type NativeOqsKekAdapter = ReturnType<typeof createNativeOqsKekAdapter>;
type NativeE2ee = ReturnType<typeof createE2ee>;

let nativeE2ee: NativeE2ee | null = null;
let nativeOqsKek: NativeOqsKekAdapter | null = null;

const FALLBACK_CRYPTO_PWHASH_ALG_ARGON2ID13 = 2;
const FALLBACK_CRYPTO_PWHASH_MEMLIMIT_INTERACTIVE = 67108864;
const FALLBACK_CRYPTO_PWHASH_OPSLIMIT_INTERACTIVE = 2;
const FALLBACK_CRYPTO_PWHASH_SALTBYTES = 16;
const FALLBACK_CRYPTO_SECRETBOX_KEYBYTES = 32;
const FALLBACK_CRYPTO_SECRETBOX_NONCEBYTES = 24;

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown native e2ee error.';
}

async function getNativeOqsKek() {
  if (nativeOqsKek) {
    return nativeOqsKek;
  }

  try {
    nativeOqsKek = createNativeOqsKekAdapter();

    return nativeOqsKek;
  } catch (error) {
    throw new Error(`Failed to load the native OQS KEK adapter: ${toErrorMessage(error)}`);
  }
}

function assertUint8ArrayResult(operationName: string, value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  throw new Error(`${operationName} returned an invalid binary result.`);
}

function resolveNativeNumber(name: string, value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  console.warn(`[e2ee-auth/native] ${name} is unavailable, using fallback ${fallback}.`);

  return fallback;
}

function requireNativeFunction<TFunction extends (...args: never[]) => unknown>(
  name: string,
  value: unknown,
) {
  if (typeof value === 'function') {
    return value as TFunction;
  }

  throw new Error(`${name} is unavailable in react-native-libsodium.`);
}

async function runNativeStage<TResult>(stage: string, operation: () => Promise<TResult>) {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`${stage} failed: ${toErrorMessage(error)}`);
  }
}

function getNativeE2ee() {
  if (nativeE2ee) {
    return nativeE2ee;
  }

  const resolvedRandombytesBuf = requireNativeFunction<typeof randombytes_buf>(
    'react-native-libsodium randombytes_buf',
    randombytes_buf,
  );
  const resolvedCryptoPwhash = requireNativeFunction<typeof crypto_pwhash>(
    'react-native-libsodium crypto_pwhash',
    crypto_pwhash,
  );
  const resolvedCryptoSecretboxEasy = requireNativeFunction<typeof crypto_secretbox_easy>(
    'react-native-libsodium crypto_secretbox_easy',
    crypto_secretbox_easy,
  );
  const resolvedCryptoSecretboxOpenEasy = requireNativeFunction<typeof crypto_secretbox_open_easy>(
    'react-native-libsodium crypto_secretbox_open_easy',
    crypto_secretbox_open_easy,
  );
  const resolvedCryptoPwhashAlgArgon2Id13 = resolveNativeNumber(
    'react-native-libsodium crypto_pwhash_ALG_ARGON2ID13',
    crypto_pwhash_ALG_ARGON2ID13,
    FALLBACK_CRYPTO_PWHASH_ALG_ARGON2ID13,
  );
  const resolvedCryptoPwhashMemlimitInteractive = resolveNativeNumber(
    'react-native-libsodium crypto_pwhash_MEMLIMIT_INTERACTIVE',
    crypto_pwhash_MEMLIMIT_INTERACTIVE,
    FALLBACK_CRYPTO_PWHASH_MEMLIMIT_INTERACTIVE,
  );
  const resolvedCryptoPwhashOpslimitInteractive = resolveNativeNumber(
    'react-native-libsodium crypto_pwhash_OPSLIMIT_INTERACTIVE',
    crypto_pwhash_OPSLIMIT_INTERACTIVE,
    FALLBACK_CRYPTO_PWHASH_OPSLIMIT_INTERACTIVE,
  );
  const resolvedCryptoPwhashSaltBytes = resolveNativeNumber(
    'react-native-libsodium crypto_pwhash_SALTBYTES',
    crypto_pwhash_SALTBYTES,
    FALLBACK_CRYPTO_PWHASH_SALTBYTES,
  );
  const resolvedCryptoSecretboxKeyBytes = resolveNativeNumber(
    'react-native-libsodium crypto_secretbox_KEYBYTES',
    crypto_secretbox_KEYBYTES,
    FALLBACK_CRYPTO_SECRETBOX_KEYBYTES,
  );
  const resolvedCryptoSecretboxNonceBytes = resolveNativeNumber(
    'react-native-libsodium crypto_secretbox_NONCEBYTES',
    crypto_secretbox_NONCEBYTES,
    FALLBACK_CRYPTO_SECRETBOX_NONCEBYTES,
  );

  nativeE2ee = createE2ee({
    async decapsulateKek(cipherText, secretKey) {
      return (await getNativeOqsKek()).decapsulate(cipherText, secretKey);
    },
    decrypt(ciphertext, nonce, key) {
      return assertUint8ArrayResult(
        'react-native-libsodium crypto_secretbox_open_easy',
        resolvedCryptoSecretboxOpenEasy(ciphertext, nonce, key),
      );
    },
    async deriveDeterministicKekKeyPair(seed) {
      return (await getNativeOqsKek()).deriveDeterministicKeyPair(seed);
    },
    derivePasswordHash(password, salt, keyLength) {
      return assertUint8ArrayResult(
        'react-native-libsodium crypto_pwhash',
        resolvedCryptoPwhash(
          keyLength,
          password,
          salt,
          resolvedCryptoPwhashOpslimitInteractive,
          resolvedCryptoPwhashMemlimitInteractive,
          resolvedCryptoPwhashAlgArgon2Id13,
        ),
      );
    },
    encrypt(message, nonce, key) {
      return assertUint8ArrayResult(
        'react-native-libsodium crypto_secretbox_easy',
        resolvedCryptoSecretboxEasy(message, nonce, key),
      );
    },
    async encapsulateKek(publicKey) {
      return (await getNativeOqsKek()).encapsulate(publicKey);
    },
    hash(message) {
      return sha512(message);
    },
    hashBytes: 64,
    kekSeedBytes: 64,
    randomBytes: (size) =>
      assertUint8ArrayResult(
        'react-native-libsodium randombytes_buf',
        resolvedRandombytesBuf(size),
      ),
    ready,
    saltBytes: resolvedCryptoPwhashSaltBytes,
    secretboxKeyBytes: resolvedCryptoSecretboxKeyBytes,
    secretboxNonceBytes: resolvedCryptoSecretboxNonceBytes,
  });

  return nativeE2ee;
}

export const createPasswordSalt: NativeE2ee['createPasswordSalt'] = (...args) =>
  runNativeStage('createPasswordSalt', async () => getNativeE2ee().createPasswordSalt(...args));

export const createApiToken: NativeE2ee['createApiToken'] = (...args) =>
  runNativeStage('createApiToken', async () => getNativeE2ee().createApiToken(...args));

export const decryptString: NativeE2ee['decryptString'] = (...args) =>
  getNativeE2ee().decryptString(...args);

export const decryptStringWithAsymmetricKek: NativeE2ee['decryptStringWithAsymmetricKek'] = (
  ...args
) => getNativeE2ee().decryptStringWithAsymmetricKek(...args);

export const decryptStringWithDek: NativeE2ee['decryptStringWithDek'] = (...args) =>
  getNativeE2ee().decryptStringWithDek(...args);

export const deriveKekKeyPair: NativeE2ee['deriveKekKeyPair'] = (...args) =>
  runNativeStage('deriveKekKeyPair', async () => getNativeE2ee().deriveKekKeyPair(...args));

export const deriveApiTokenCredentials: NativeE2ee['deriveApiTokenCredentials'] = (...args) =>
  runNativeStage('deriveApiTokenCredentials', async () =>
    getNativeE2ee().deriveApiTokenCredentials(...args),
  );

export const deriveCredentials: NativeE2ee['deriveCredentials'] = (...args) =>
  runNativeStage('deriveCredentials', async () => getNativeE2ee().deriveCredentials(...args));

export const encryptString: NativeE2ee['encryptString'] = (...args) =>
  getNativeE2ee().encryptString(...args);

export const encryptStringWithAsymmetricKek: NativeE2ee['encryptStringWithAsymmetricKek'] = (
  ...args
) => getNativeE2ee().encryptStringWithAsymmetricKek(...args);

export const encryptStringWithAsymmetricKeks: NativeE2ee['encryptStringWithAsymmetricKeks'] = (
  ...args
) => getNativeE2ee().encryptStringWithAsymmetricKeks(...args);

export const encryptStringWithDek: NativeE2ee['encryptStringWithDek'] = (...args) =>
  getNativeE2ee().encryptStringWithDek(...args);

export const normalizeEmail: NativeE2ee['normalizeEmail'] = (...args) =>
  getNativeE2ee().normalizeEmail(...args);

export const rewrapAsymmetricEncryptedDek: NativeE2ee['rewrapAsymmetricEncryptedDek'] = (
  ...args
) => getNativeE2ee().rewrapAsymmetricEncryptedDek(...args);

export const rewrapEncryptedDek: NativeE2ee['rewrapEncryptedDek'] = (...args) =>
  getNativeE2ee().rewrapEncryptedDek(...args);
export type {
  CryptKey,
  DerivedApiTokenCredentials,
  DerivedCredentials,
  EncryptedPayload,
  KekAsymmetricDekEncryptedPayload,
  MultiRecipientKekAsymmetricDekEncryptedPayload,
  KekAsymmetricWrappedPayload,
  KekKeyPair,
  KekDekEncryptedPayload,
  KekWrappedPayload,
} from './core';