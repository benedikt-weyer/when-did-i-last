import type {
  ImportExportSuiteInspection,
  ImportExportSuiteNote,
} from '@repo/import-export-suite/native';
import { useRouter } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { useAuth } from '../features/auth/auth-context';
import {
  createMobileOfflineNotesSyncAdapter,
  getMobileOfflineNotesProvider,
} from '../features/e2ee/offline-notes';
import {
  getExpoDocumentPickerModule,
  getExpoSharingModule,
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
    const adapter = createMobileOfflineNotesSyncAdapter({
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

  async function handleExportNotes() {
    if (notes.length === 0) {
      setStatusMessage('Create or sync at least one card before exporting JSON.');
      return;
    }

    setIsExportingNotes(true);

    try {
      const { exportImportExportSuite } = await getNativeImportExportSuiteModule();
      const Sharing = await getExpoSharingModule();
      const noteLabel = `card${notes.length === 1 ? '' : 's'}`;
      const protectionLabel = exportPassword ? 'password-protected JSON' : 'cleartext JSON';
      const sharingAvailable = await Sharing.isAvailableAsync();

      if (!sharingAvailable) {
        throw new Error('File sharing is unavailable on this device.');
      }

      const serialized = await exportImportExportSuite(
        notes.map((note) => toBackupNote(note)),
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
      setStatusMessage(`Exported ${notes.length} ${noteLabel} as ${protectionLabel}.`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to export the cards as JSON.',
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

  async function saveImportedNotes(importedNotes: ImportExportSuiteNote[]) {
    let createdCount = 0;
    let updatedCount = 0;
    const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();

    for (const importedNote of importedNotes) {
      const existingNote = notes.find((note) => note.id === importedNote.id) ?? null;

      await mobileOfflineNotesProvider.saveNote({
        content: importedNote.content,
        id: importedNote.id,
        title: importedNote.title,
      });

      if (existingNote) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }
    }

    return { createdCount, updatedCount };
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
        setStatusMessage('The selected import file does not contain any cards.');
        return;
      }

      const { createdCount, updatedCount } = await saveImportedNotes(importedNotes);
      const syncPending = await syncImportedNotes();

      resetImportState();
      setStatusMessage(
        syncPending
          ? `${buildImportSummary(createdCount, updatedCount)} Sync pending.`
          : buildImportSummary(createdCount, updatedCount),
      );
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
          disabled={isExportingNotes || notes.length === 0}
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

function buildImportSummary(createdCount: number, updatedCount: number) {
  const segments = [];

  if (updatedCount > 0) {
    segments.push(`updated ${updatedCount}`);
  }

  if (createdCount > 0) {
    segments.push(`created ${createdCount}`);
  }

  return segments.length > 0
    ? `Imported cards: ${segments.join(' and ')}.`
    : 'The import file did not produce any card changes.';
}

function describeSelectedImport(fileName: string, inspection: ImportExportSuiteInspection) {
  const noteLabel = `card${inspection.noteCount === 1 ? '' : 's'}`;
  const protectionLabel = inspection.encrypted
    ? 'Password protection is enabled.'
    : 'This export is cleartext.';

  return `Selected ${fileName} with ${inspection.noteCount} ${noteLabel}. ${protectionLabel}`;
}

function sortNotes(notes: DecryptedNote[]) {
  return [...notes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}