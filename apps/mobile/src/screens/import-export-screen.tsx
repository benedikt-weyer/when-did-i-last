import type {
  ImportExportSuiteInspection,
  ImportExportSuiteNote,
} from '@repo/import-export-suite/native';
import { useRouter } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  parseNoteOrganization,
  serializeFolderOrganization,
} from '@repo/offline-provider';

import { ScreenShell } from '../components/screen-shell';
import { useAuth } from '../features/auth/auth-context';
import { fetchLinkedPrincipals } from '../features/auth/auth-api';
import {
  createMobileOfflineNotesSyncAdapter,
  getMobileOfflineNotesProvider,
} from '../features/e2ee/offline-notes';
import { fetchFolders, saveFolder } from '../features/e2ee/folder-api';
import {
  getExpoDocumentPickerModule,
  getExpoSharingModule,
  getNativeAuthModule,
  getNativeImportExportSuiteModule,
} from '../features/e2ee/native-runtime';
import { useAppTheme } from '../features/theme/theme-context';
import { themeTokens } from '../theme/theme-tokens';

type DecryptedNote = {
  content: string;
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
};

type DecryptedFolder = {
  createdAt: string;
  id: string;
  parentFolderId: string | null;
  title: string;
  updatedAt: string;
};

export function ImportExportScreen() {
  const {
    activeKekId,
    backendUrl,
    linkedKeks,
    runWithFreshSession,
    session,
  } = useAuth();
  const { themeMode } = useAppTheme();
  const router = useRouter();
  const tokens = themeTokens[themeMode];
  const isMountedRef = useRef(true);
  const [notes, setNotes] = useState<DecryptedNote[]>([]);
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importInspection, setImportInspection] = useState<ImportExportSuiteInspection | null>(null);
  const [importPayload, setImportPayload] = useState<string | null>(null);
  const [isExportingNotes, setIsExportingNotes] = useState(false);
  const [isImportingNotes, setIsImportingNotes] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const applyOfflineSnapshot = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }

    const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();

    setNotes(
      sortNotes(
        mobileOfflineNotesProvider.getSnapshot().notes.map((note) => ({
          content: note.content,
          createdAt: note.createdAt,
          id: note.id,
          title: note.title,
          updatedAt: note.updatedAt,
        })),
      ),
    );
  }, []);

  const syncOfflineNotes = useCallback(async (nextSession: NonNullable<typeof session>) => {
    if (!activeKekId || linkedKeks.length === 0) {
      throw new Error('No linked KEK is available for syncing cards yet.');
    }

    const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
    const adapter = await createMobileOfflineNotesSyncAdapter({
      activeKekId,
      backendUrl,
      linkedKeks,
      runWithFreshSession,
      session: nextSession,
    });

    await mobileOfflineNotesProvider.sync(adapter);
  }, [activeKekId, backendUrl, linkedKeks, runWithFreshSession]);

  useEffect(() => {
    let unsubscribe = () => {};

    void getMobileOfflineNotesProvider().then((mobileOfflineNotesProvider) => {
      unsubscribe = mobileOfflineNotesProvider.subscribe(() => {
        void applyOfflineSnapshot();
      });

      return mobileOfflineNotesProvider.initialize().then(() => applyOfflineSnapshot());
    }).catch((error) => {
      if (isMountedRef.current) {
        setStatusMessage(
          error instanceof Error ? error.message : 'Unable to initialize the offline cards store.',
        );
      }
    });

    return unsubscribe;
  }, [applyOfflineSnapshot]);

  useEffect(() => {
    if (!session || linkedKeks.length === 0 || !activeKekId) {
      return;
    }

    void syncOfflineNotes(session).then(async () => {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const noteCount = mobileOfflineNotesProvider.getSnapshot().notes.length;

      setStatusMessage(buildInitialNoteSyncMessage(noteCount));
    }).catch(async (error) => {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const noteCount = mobileOfflineNotesProvider.getSnapshot().notes.length;

      setStatusMessage(buildOfflineSyncFailureMessage(noteCount, error));
    });
  }, [activeKekId, linkedKeks.length, session, syncOfflineNotes]);

  async function fetchDecryptedFolders(): Promise<DecryptedFolder[]> {
    if (!session || linkedKeks.length === 0 || !activeKekId) {
      return [];
    }

    const { decryptStringWithAsymmetricKek } = await getNativeAuthModule();
    const remoteFolders = await runWithFreshSession((activeSession) =>
      fetchFolders({ baseUrl: backendUrl, token: activeSession.token }),
    );

    return Promise.all(
      remoteFolders.map(async (folder) => {
        const kek = linkedKeks.find((entry) => entry.kekPublicKey === folder.encryptedDek.kekPublicKey);

        if (!kek) {
          throw new Error(`Missing the local KEK for folder ${folder.encryptedDek.kekPublicKey}.`);
        }

        const document = parseFolderDocument(await decryptStringWithAsymmetricKek(folder, kek.cryptKey));

        return {
          createdAt: folder.createdAt,
          id: folder.id,
          parentFolderId: document.parentFolderId,
          title: document.name,
          updatedAt: folder.updatedAt,
        };
      }),
    );
  }

  async function handleExportNotes() {
    setIsExportingNotes(true);

    try {
      const folders = await fetchDecryptedFolders();

      if (notes.length === 0 && folders.length === 0) {
        setStatusMessage('Create or sync at least one card or folder before exporting JSON.');
        return;
      }

      const { exportImportExportSuite } = await getNativeImportExportSuiteModule();
      const Sharing = await getExpoSharingModule();
      const backupItems = [
        ...notes.map((note) => toBackupNote(note)),
        ...folders.map((folder) => toBackupFolderNote(folder)),
      ];
      const protectionLabel = exportPassword ? 'password-protected JSON' : 'cleartext JSON';
      const sharingAvailable = await Sharing.isAvailableAsync();

      if (!sharingAvailable) {
        throw new Error('File sharing is unavailable on this device.');
      }

      const serialized = await exportImportExportSuite(
        backupItems,
        exportPassword
          ? {
              password: exportPassword,
            }
          : undefined,
      );
      const filename = buildImportExportSuiteFilename(new Date().toISOString());
      const file = new File(Paths.cache, filename);

      file.create({ overwrite: true });
      file.write(serialized);
      await Sharing.shareAsync(file.uri, {
        dialogTitle: 'Share exported cards JSON',
        mimeType: 'application/json',
        UTI: 'public.json',
      });
      setExportPassword('');
      setStatusMessage(
        `Exported ${notes.length} card${notes.length === 1 ? '' : 's'} and ${folders.length} folder${folders.length === 1 ? '' : 's'} as ${protectionLabel}.`,
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to export the cards and folders as JSON.',
      );
    } finally {
      setIsExportingNotes(false);
    }
  }

  async function handlePickImportFile() {
    try {
      const DocumentPicker = await getExpoDocumentPickerModule();
      const { inspectImportExportSuite } = await getNativeImportExportSuiteModule();
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['application/json', 'text/json'],
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];

      if (!asset) {
        throw new Error('The selected import file is missing.');
      }

      const file = new File(asset.uri);
      const serialized = await file.text();
      const inspection = inspectImportExportSuite(serialized);

      setImportPayload(serialized);
      setImportFileName(asset.name);
      setImportInspection(inspection);
      setStatusMessage(
        inspection.encrypted
          ? `Selected ${asset.name}. This export is password protected.`
          : `Selected ${asset.name}. This export contains cleartext JSON.`,
      );
    } catch (error) {
      setImportPayload(null);
      setImportFileName('');
      setImportInspection(null);
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to read the selected import file.',
      );
    }
  }

  async function saveImportedFolder(
    importedNote: ImportExportSuiteNote,
    parentFolderId: string | null,
    existingFolders: DecryptedFolder[],
  ) {
    if (!session) {
      throw new Error('Connect to the backend before importing folders.');
    }

    const { encryptStringWithAsymmetricKeks } = await getNativeAuthModule();
    const linkedPrincipals = await runWithFreshSession((activeSession) =>
      fetchLinkedPrincipals({ baseUrl: backendUrl, token: activeSession.token }),
    );
    const encrypted = await encryptStringWithAsymmetricKeks(
      JSON.stringify({ name: importedNote.title, parentFolderId, version: 1 }),
      linkedPrincipals.map((principal) => principal.latestKekPublicKey),
    );

    await runWithFreshSession((activeSession) =>
      saveFolder({
        baseUrl: backendUrl,
        folderId: importedNote.id,
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

    return existingFolders.some((folder) => folder.id === importedNote.id);
  }

  async function saveImportedNotes(importedNotes: ImportExportSuiteNote[]) {
    let createdCardCount = 0;
    let updatedCardCount = 0;
    let createdFolderCount = 0;
    let updatedFolderCount = 0;
    const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
    const existingFolders = await fetchDecryptedFolders();

    for (const importedNote of importedNotes) {
      const organization = parseNoteOrganization(importedNote.content);

      if (organization.kind === 'folder') {
        const wasExisting = await saveImportedFolder(
          importedNote,
          organization.parentFolderId,
          existingFolders,
        );

        if (wasExisting) {
          updatedFolderCount += 1;
        } else {
          createdFolderCount += 1;
        }

        continue;
      }

      const existingNote = notes.find((note) => note.id === importedNote.id) ?? null;

      await mobileOfflineNotesProvider.saveNote({
        content: importedNote.content,
        id: importedNote.id,
        title: importedNote.title,
      });

      if (existingNote) {
        updatedCardCount += 1;
      } else {
        createdCardCount += 1;
      }
    }

    return { createdCardCount, createdFolderCount, updatedCardCount, updatedFolderCount };
  }

  async function syncImportedNotes() {
    if (!session || linkedKeks.length === 0 || !activeKekId) {
      return true;
    }

    try {
      await syncOfflineNotes(session);
      return false;
    } catch {
      return true;
    }
  }

  function resetImportState() {
    setImportPayload(null);
    setImportFileName('');
    setImportInspection(null);
    setImportPassword('');
  }

  async function handleImportNotes() {
    if (!importPayload) {
      setStatusMessage('Choose a JSON import file before importing cards.');
      return;
    }

    setIsImportingNotes(true);

    try {
      const { importImportExportSuite } = await getNativeImportExportSuiteModule();
      const importedNotes = await importImportExportSuite(
        importPayload,
        importPassword
          ? {
              password: importPassword,
            }
          : undefined,
      );

      if (importedNotes.length === 0) {
        setStatusMessage('The selected import file does not contain any cards or folders.');
        return;
      }

      const { createdCardCount, createdFolderCount, updatedCardCount, updatedFolderCount } =
        await saveImportedNotes(importedNotes);
      const syncPending = await syncImportedNotes();
      const summary = buildImportSummary(
        createdCardCount,
        updatedCardCount,
        createdFolderCount,
        updatedFolderCount,
      );

      resetImportState();
      setStatusMessage(syncPending ? `${summary} Sync pending.` : summary);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to import the JSON export.',
      );
    } finally {
      setIsImportingNotes(false);
    }
  }

  const noteCountLabel = notes.length === 1 ? 'card' : 'cards';
  const noteSnapshotMessage =
    notes.length === 0 ? 'No local cards yet.' : `${notes.length} ${noteCountLabel} ready.`;

  return (
    <ScreenShell
      themeMode={themeMode}
      title="Import / export"
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

      <Text className={`text-sm ${tokens.body}`}>{noteSnapshotMessage}</Text>

      <View className="gap-3">
        <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
          Export JSON
        </Text>
        <TextInput
          autoCapitalize="none"
          className={`rounded-[22px] border px-4 py-3 text-base ${tokens.card} ${tokens.title}`}
          onChangeText={setExportPassword}
          placeholder="Optional export password"
          placeholderTextColor={themeMode === 'dark' ? '#94a3b8' : '#78716c'}
          secureTextEntry
          value={exportPassword}
        />
        <Pressable
          className={`items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
          disabled={isExportingNotes}
          onPress={() => {
            void handleExportNotes();
          }}
        >
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
            {isExportingNotes ? 'Exporting JSON...' : 'Export JSON'}
          </Text>
        </Pressable>
      </View>

      <View className="gap-3">
        <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
          Import JSON
        </Text>
        <Pressable
          className="items-center rounded-full border border-stone-300 px-4 py-4 dark:border-slate-700"
          onPress={() => {
            void handlePickImportFile();
          }}
        >
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.title}`}>
            Choose import file
          </Text>
        </Pressable>
        <TextInput
          autoCapitalize="none"
          className={`rounded-[22px] border px-4 py-3 text-base ${tokens.card} ${tokens.title}`}
          onChangeText={setImportPassword}
          placeholder={importInspection?.encrypted ? 'Enter the custom export password' : 'Import password only for encrypted exports'}
          placeholderTextColor={themeMode === 'dark' ? '#94a3b8' : '#78716c'}
          secureTextEntry
          value={importPassword}
        />
        <Text className={`text-sm leading-6 ${tokens.body}`}>
          {importInspection
            ? describeSelectedImport(importFileName, importInspection)
            : 'No import file selected yet.'}
        </Text>
        <Pressable
          className={`items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
          disabled={isImportingNotes || !importPayload}
          onPress={() => {
            void handleImportNotes();
          }}
        >
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
            {isImportingNotes ? 'Importing JSON...' : 'Import selected JSON'}
          </Text>
        </Pressable>
      </View>

      {statusMessage ? <Text className={`text-sm ${tokens.body}`}>{statusMessage}</Text> : null}
    </ScreenShell>
  );
}

function toBackupNote(note: DecryptedNote): ImportExportSuiteNote {
  return {
    content: note.content,
    createdAt: note.createdAt,
    id: note.id,
    title: note.title,
    updatedAt: note.updatedAt,
  };
}

function toBackupFolderNote(folder: DecryptedFolder): ImportExportSuiteNote {
  return {
    content: serializeFolderOrganization(folder.parentFolderId),
    createdAt: folder.createdAt,
    id: folder.id,
    title: folder.title,
    updatedAt: folder.updatedAt,
  };
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

function buildImportExportSuiteFilename(exportedAt: string) {
  const safeTimestamp = exportedAt.replace(/[.:]/g, '-');

  return `import-export-suite-${safeTimestamp}.json`;
}

function buildInitialNoteSyncMessage(noteCount: number) {
  if (noteCount === 0) {
    return 'No synced cards yet. Create one to push ciphertext to the backend.';
  }

  return `Loaded ${noteCount} encrypted card${noteCount === 1 ? '' : 's'} from the local offline store.`;
}

function buildOfflineSyncFailureMessage(noteCount: number, error: unknown) {
  if (noteCount > 0) {
    return `Loaded ${noteCount} offline card${noteCount === 1 ? '' : 's'}. Sync will resume when the backend is reachable.`;
  }

  return error instanceof Error ? error.message : 'Unable to sync encrypted cards.';
}

function buildImportSummary(
  createdCardCount: number,
  updatedCardCount: number,
  createdFolderCount: number,
  updatedFolderCount: number,
) {
  const segments = [];

  if (updatedCardCount > 0) {
    segments.push(`updated ${updatedCardCount} card${updatedCardCount === 1 ? '' : 's'}`);
  }

  if (createdCardCount > 0) {
    segments.push(`created ${createdCardCount} card${createdCardCount === 1 ? '' : 's'}`);
  }

  if (updatedFolderCount > 0) {
    segments.push(`updated ${updatedFolderCount} folder${updatedFolderCount === 1 ? '' : 's'}`);
  }

  if (createdFolderCount > 0) {
    segments.push(`created ${createdFolderCount} folder${createdFolderCount === 1 ? '' : 's'}`);
  }

  return segments.length > 0
    ? `Imported: ${segments.join(', ')}.`
    : 'The import file did not produce any changes.';
}

function describeSelectedImport(fileName: string, inspection: ImportExportSuiteInspection) {
  const itemLabel = `item${inspection.noteCount === 1 ? '' : 's'}`;
  const protectionLabel = inspection.encrypted
    ? 'Password protection is enabled.'
    : 'This export is cleartext.';

  return `Selected ${fileName} with ${inspection.noteCount} ${itemLabel}. ${protectionLabel}`;
}

function sortNotes(notes: DecryptedNote[]) {
  return [...notes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}