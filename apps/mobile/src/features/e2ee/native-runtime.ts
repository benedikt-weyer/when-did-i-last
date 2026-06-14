import { NativeModules } from 'react-native';

type NativeAuthModule = typeof import('@repo/e2ee-auth/native');
type NativeImportExportSuiteModule = typeof import('@repo/import-export-suite/native');
type NativeOfflineNotesProviderModule = typeof import('@repo/offline-provider/native');
type ExpoDocumentPickerModule = typeof import('expo-document-picker');
type ExpoSharingModule = typeof import('expo-sharing');

const REQUIRED_AUTH_EXPORTS = [
  'createPasswordSalt',
  'deriveCredentials',
  'deriveKekKeyPair',
] as const;

const NATIVE_BUILD_REQUIRED_MESSAGE =
  'This mobile runtime is missing required native modules. Start a rebuilt Android dev client with `pnpm --dir apps/mobile expo run:android` instead of Expo Go, then relaunch the app.';

function toError(error: unknown) {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  return new Error('Unknown native runtime error.');
}

function wrapNativeRuntimeError(error: unknown) {
  const resolvedError = toError(error);

  if (
    /Cannot find native module|native module|Libsodium module not defined/i.test(
      resolvedError.message,
    )
  ) {
    return new Error(NATIVE_BUILD_REQUIRED_MESSAGE);
  }

  return resolvedError;
}

function assertLibsodiumRuntime() {
  if (!NativeModules.Libsodium) {
    throw new Error(NATIVE_BUILD_REQUIRED_MESSAGE);
  }
}

function assertNativeModuleObject<TModule extends object>(
  moduleName: string,
  loadedModule: unknown,
): asserts loadedModule is TModule {
  if (!loadedModule || typeof loadedModule !== 'object') {
    throw new Error(`${moduleName} returned an invalid module value.`);
  }
}

function assertNativeAuthModule(loadedModule: unknown): asserts loadedModule is NativeAuthModule {
  assertNativeModuleObject<NativeAuthModule>('@repo/e2ee-auth/native', loadedModule);

  const missingExports = REQUIRED_AUTH_EXPORTS.filter(
    (exportName) => typeof loadedModule[exportName] !== 'function',
  );

  if (missingExports.length > 0) {
    throw new Error(
      `@repo/e2ee-auth/native is missing required exports: ${missingExports.join(', ')}.`,
    );
  }
}

export async function getNativeAuthModule() {
  assertLibsodiumRuntime();

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nativeAuthModule = require('@repo/e2ee-auth/native');

    assertNativeAuthModule(nativeAuthModule);

    return nativeAuthModule;
  } catch (error) {
    throw wrapNativeRuntimeError(error);
  }
}

export async function getNativeImportExportSuiteModule() {
  assertLibsodiumRuntime();

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nativeImportExportSuiteModule = require('@repo/import-export-suite/native');

    assertNativeModuleObject<NativeImportExportSuiteModule>(
      '@repo/import-export-suite/native',
      nativeImportExportSuiteModule,
    );

    return nativeImportExportSuiteModule;
  } catch (error) {
    throw wrapNativeRuntimeError(error);
  }
}

export async function getExpoDocumentPickerModule() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoDocumentPickerModule = require('expo-document-picker');

    assertNativeModuleObject<ExpoDocumentPickerModule>(
      'expo-document-picker',
      expoDocumentPickerModule,
    );

    return expoDocumentPickerModule;
  } catch (error) {
    throw wrapNativeRuntimeError(error);
  }
}

export async function getExpoSharingModule() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoSharingModule = require('expo-sharing');

    assertNativeModuleObject<ExpoSharingModule>('expo-sharing', expoSharingModule);

    return expoSharingModule;
  } catch (error) {
    throw wrapNativeRuntimeError(error);
  }
}

export async function getNativeOfflineNotesProviderModule() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nativeOfflineNotesProviderModule = require('@repo/offline-provider/native');

    assertNativeModuleObject<NativeOfflineNotesProviderModule>(
      '@repo/offline-provider/native',
      nativeOfflineNotesProviderModule,
    );

    return nativeOfflineNotesProviderModule;
  } catch (error) {
    throw wrapNativeRuntimeError(error);
  }
}