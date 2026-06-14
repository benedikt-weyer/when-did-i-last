import sodium from 'libsodium-wrappers-sumo';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native-libsodium', async () => {
  await sodium.ready;

  return {
    crypto_pwhash: sodium.crypto_pwhash,
    crypto_pwhash_ALG_ARGON2ID13: sodium.crypto_pwhash_ALG_ARGON2ID13,
    crypto_pwhash_MEMLIMIT_INTERACTIVE: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    crypto_pwhash_OPSLIMIT_INTERACTIVE: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    crypto_pwhash_SALTBYTES: sodium.crypto_pwhash_SALTBYTES,
    crypto_secretbox_easy: sodium.crypto_secretbox_easy,
    crypto_secretbox_KEYBYTES: sodium.crypto_secretbox_KEYBYTES,
    crypto_secretbox_NONCEBYTES: sodium.crypto_secretbox_NONCEBYTES,
    crypto_secretbox_open_easy: sodium.crypto_secretbox_open_easy,
    randombytes_buf: sodium.randombytes_buf,
    ready: Promise.resolve(),
  };
});

describe('native asymmetric KEK support', () => {
  it('round-trips asymmetric note encryption through the native driver', async () => {
    vi.resetModules();

    const { createWebOqsKekAdapter } = await import('@repo/oqs-kek/web');

    vi.doMock('@repo/oqs-kek/native', () => ({
      createNativeOqsKekAdapter: createWebOqsKekAdapter,
    }));

    const {
      decryptStringWithAsymmetricKek,
      deriveCredentials,
      deriveKekKeyPair,
      encryptStringWithAsymmetricKek,
    } = await import('./native');
    const credentials = await deriveCredentials(
      'person@example.com',
      'correct horse',
      '00112233445566778899aabbccddeeff',
    );
    const kekKeyPair = await deriveKekKeyPair(credentials.cryptKey);
    const payload = await encryptStringWithAsymmetricKek('secret note', kekKeyPair.kekPublicKey);

    await expect(decryptStringWithAsymmetricKek(payload, credentials.cryptKey)).resolves.toBe(
      'secret note',
    );
  });
});