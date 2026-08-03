'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  exportImportExportSuite,
  importImportExportSuite,
  inspectImportExportSuite,
  type ImportExportSuiteInspection,
  type ImportExportSuiteNote,
} from '@repo/import-export-suite/web';
import {
  parseNoteOrganization,
  serializeFolderOrganization,
} from '@repo/offline-provider';
import { decryptStringWithAsymmetricKek, encryptStringWithAsymmetricKeks } from '@repo/e2ee-auth/web';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { fetchLinkedPrincipals } from '@/lib/auth-api';
import { fetchFolders, saveFolder } from '@/lib/folder-api';

import {
  LabeledInput,
  PageShell,
  SignedOutForm,
  StatusPanel,
  panelClassName,
  sectionClassName,
  useSessionPageState,
} from '../shared/session-page';
import {
  getOfflineNoteSnapshot,
  syncOfflineNotes,
  webOfflineNotesProvider,
} from '../shared/offline-note-sync';
import {
  buildImportExportSuiteFilename,
  buildImportSummary,
  buildInitialNoteSyncMessage,
  buildOfflineSyncFailureMessage,
  buildPostLoginNoteMessage,
  downloadTextFile,
  toBackupNote,
  type DecryptedNote,
} from '../shared/session-page-helpers';

type DecryptedFolder = {
  createdAt: string;
  id: string;
  parentFolderId: string | null;
  title: string;
  updatedAt: string;
};

export function SettingsPageClient() {
  const [notes, setNotes] = useState<DecryptedNote[]>([]);
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importInspection, setImportInspection] =
    useState<ImportExportSuiteInspection | null>(null);
  const [importPayload, setImportPayload] = useState<string | null>(null);
  const [isExportingNotes, setIsExportingNotes] = useState(false);
  const [isImportingNotes, setIsImportingNotes] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const applyOfflineSnapshot = useCallback(() => {
    setNotes(getOfflineNoteSnapshot());
  }, []);

  const shared = useSessionPageState({
    onAuthenticated: async ({ linkedKeks, mode, session, trimmedBackendUrl }) => {
      const syncedNotes = await syncOfflineNotes({
        linkedKeks,
        nextSession: session,
        runWithSessionRetry: shared.runWithSessionRetry,
        trimmedBackendUrl,
      });

      setNotes(syncedNotes);
      return buildPostLoginNoteMessage(mode, syncedNotes.length);
    },
  });
  const {
    backendUrl,
    isHydrated,
    linkedKeks,
    runWithSessionRetry,
    session,
    setStatusMessage,
  } = shared;

  useEffect(() => {
    let isCancelled = false;

    const unsubscribe = webOfflineNotesProvider.subscribe(() => {
      if (!isCancelled) {
        applyOfflineSnapshot();
      }
    });

    webOfflineNotesProvider.initialize().then(() => {
      if (!isCancelled) {
        applyOfflineSnapshot();
      }
    }).catch((error) => {
      if (!isCancelled) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Unable to initialize the offline cards store.',
        );
      }
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [applyOfflineSnapshot, setStatusMessage]);

  useEffect(() => {
    if (!isHydrated || !session || linkedKeks.length === 0) {
      return;
    }

    let isCancelled = false;
    const currentSession = session;
    const trimmedBackendUrl = backendUrl.trim();

    queueMicrotask(() => {
      if (isCancelled) {
        return;
      }

      void syncOfflineNotes({
        linkedKeks,
        nextSession: currentSession,
        runWithSessionRetry,
        trimmedBackendUrl,
      }).then((syncedNotes) => {
        if (isCancelled) {
          return;
        }

        setNotes(syncedNotes);
        setStatusMessage(buildInitialNoteSyncMessage(syncedNotes.length));
      }).catch((error) => {
        if (isCancelled) {
          return;
        }

        setStatusMessage(buildOfflineSyncFailureMessage(getOfflineNoteSnapshot().length, error));
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [
    backendUrl,
    isHydrated,
    linkedKeks,
    runWithSessionRetry,
    session,
    setStatusMessage,
  ]);

  async function fetchDecryptedFolders(): Promise<DecryptedFolder[]> {
    if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
      return [];
    }

    const remoteFolders = await shared.runWithSessionRetry(
      shared.session,
      shared.backendUrl.trim(),
      (activeSession) => fetchFolders({ baseUrl: shared.backendUrl, token: activeSession.token }),
    );

    return Promise.all(
      remoteFolders.map(async (folder) => {
        const kek = shared.linkedKeks.find((entry) => entry.kekPublicKey === folder.encryptedDek.kekPublicKey);

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

  async function saveImportedFolder(
    importedNote: ImportExportSuiteNote,
    parentFolderId: string | null,
    existingFolders: DecryptedFolder[],
  ) {
    if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
      throw new Error('Connect to the backend before importing folders.');
    }

    const principals = await shared.runWithSessionRetry(
      shared.session,
      shared.backendUrl.trim(),
      (activeSession) => fetchLinkedPrincipals({ baseUrl: shared.backendUrl, token: activeSession.token }),
    );
    const encrypted = await encryptStringWithAsymmetricKeks(
      JSON.stringify({ name: importedNote.title, parentFolderId, version: 1 }),
      principals.map((principal) => principal.latestKekPublicKey),
    );

    await shared.runWithSessionRetry(
      shared.session,
      shared.backendUrl.trim(),
      (activeSession) => saveFolder({
        baseUrl: shared.backendUrl,
        folderId: importedNote.id,
        payload: {
          encryptedDeks: encrypted.encryptedDeks.map((dek, index) => ({
            ...dek,
            userId: principals[index]!.id,
          })),
          encryptedPayload: encrypted.encryptedPayload,
        },
        token: activeSession.token,
      }),
    );

    return existingFolders.some((folder) => folder.id === importedNote.id);
  }

  async function handleExportNotes() {
    shared.setErrorMessage(null);
    setIsExportingNotes(true);

    try {
      const folders = await fetchDecryptedFolders();

      if (notes.length === 0 && folders.length === 0) {
        shared.setStatusMessage('Create or sync at least one card or folder before exporting JSON.');
        return;
      }

      const backupItems = [
        ...notes.map((note) => toBackupNote(note)),
        ...folders.map((folder) => toBackupFolderNote(folder)),
      ];
      const protectionLabel = exportPassword ? 'password-protected JSON' : 'cleartext JSON';
      const serialized = await exportImportExportSuite(
        backupItems,
        exportPassword
          ? {
              password: exportPassword,
            }
          : undefined,
      );
      const filename = buildImportExportSuiteFilename(new Date().toISOString());

      downloadTextFile(filename, serialized, 'application/json');
      setExportPassword('');
      shared.setStatusMessage(
        `Exported ${notes.length} card${notes.length === 1 ? '' : 's'} and ${folders.length} folder${folders.length === 1 ? '' : 's'} as ${protectionLabel}.`,
      );
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to export the cards and folders as JSON.',
      );
    } finally {
      setIsExportingNotes(false);
    }
  }

  async function handleImportFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    shared.setErrorMessage(null);

    try {
      const serialized = await file.text();
      const inspection = inspectImportExportSuite(serialized);

      setImportPayload(serialized);
      setImportFileName(file.name);
      setImportInspection(inspection);
      shared.setStatusMessage(
        inspection.encrypted
          ? `Selected ${file.name}. This export is password protected.`
          : `Selected ${file.name}. This export contains cleartext JSON.`,
      );
    } catch (error) {
      setImportPayload(null);
      setImportFileName('');
      setImportInspection(null);
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to read the selected import file.',
      );
    } finally {
      event.target.value = '';
    }
  }

  async function handleImportNotes() {
    if (!importPayload) {
      shared.setErrorMessage('Choose a JSON import file before importing cards.');
      return;
    }

    shared.setErrorMessage(null);
    setIsImportingNotes(true);

    try {
      const importedNotes = await importImportExportSuite(
        importPayload,
        importPassword
          ? {
              password: importPassword,
            }
          : undefined,
      );

      if (importedNotes.length === 0) {
        shared.setStatusMessage('The selected import file does not contain any cards or folders.');
        return;
      }

      let createdCardCount = 0;
      let updatedCardCount = 0;
      let createdFolderCount = 0;
      let updatedFolderCount = 0;
      let syncPending = false;
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

        await webOfflineNotesProvider.saveNote({
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

      applyOfflineSnapshot();

      if (shared.session && shared.linkedKeks.length > 0 && shared.backendUrl.trim()) {
        try {
          const syncedNotes = await syncOfflineNotes({
            linkedKeks: shared.linkedKeks,
            nextSession: shared.session,
            runWithSessionRetry: shared.runWithSessionRetry,
            trimmedBackendUrl: shared.backendUrl.trim(),
          });

          setNotes(syncedNotes);
        } catch (error) {
          syncPending = true;
          shared.setErrorMessage(
            error instanceof Error ? error.message : 'Unable to sync the imported cards.',
          );
        }
      } else {
        syncPending = true;
      }

      setImportPayload(null);
      setImportFileName('');
      setImportInspection(null);
      setImportPassword('');

      const summary = buildImportSummary(
        createdCardCount,
        updatedCardCount,
        createdFolderCount,
        updatedFolderCount,
      );

      shared.setStatusMessage(syncPending ? `${summary} Sync pending.` : summary);
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to import the JSON export.',
      );
    } finally {
      setIsImportingNotes(false);
    }
  }

  return (
    <PageShell title="Settings">
      {shared.session ? (
        <div className="grid gap-4">
          <div className={panelClassName}>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Card data
            </p>
            <div className={sectionClassName}>
              <p className="text-base font-semibold text-foreground">
                {notes.length} encrypted card{notes.length === 1 ? '' : 's'} available on this device.
              </p>
              <p className="text-sm leading-6 text-foreground/72">
                Export your current local card set as JSON or import a previous backup into the offline store.
              </p>
              <Link
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                href="/settings/e2ee-health"
              >
                Check e2ee health &rarr;
              </Link>
            </div>
          </div>

          <div className={panelClassName} id="transfer">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Import / export
            </p>
            <LabeledInput
              autoComplete="new-password"
              label="Export password"
              onChange={setExportPassword}
              placeholder="Optional"
              type="password"
              value={exportPassword}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                disabled={isExportingNotes}
                onClick={() => {
                  void handleExportNotes();
                }}
                size="lg"
                variant="outline"
              >
                {isExportingNotes ? 'Exporting JSON...' : 'Export JSON'}
              </Button>
              <Button
                onClick={() => {
                  importFileInputRef.current?.click();
                }}
                size="lg"
                variant="outline"
              >
                Choose import file
              </Button>
            </div>
            <input
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportFileSelection}
              ref={importFileInputRef}
              type="file"
            />
            <LabeledInput
              autoComplete="current-password"
              label="Import password"
              onChange={setImportPassword}
              placeholder={importInspection?.encrypted ? 'Required for encrypted exports' : 'Only needed for encrypted exports'}
              type="password"
              value={importPassword}
            />
            <div className="rounded-[1.2rem] border border-border/60 bg-background/80 px-4 py-3 text-sm leading-6 text-foreground/75">
              {importInspection ? (
                <p>
                  {importFileName} · {importInspection.noteCount} item{importInspection.noteCount === 1 ? '' : 's'} · {importInspection.encrypted ? 'encrypted' : 'cleartext'}
                </p>
              ) : (
                <p>No import file selected.</p>
              )}
            </div>
            <Button
              disabled={isImportingNotes || !importPayload}
              onClick={() => {
                void handleImportNotes();
              }}
              size="lg"
            >
              {isImportingNotes ? 'Importing JSON...' : 'Import selected JSON'}
            </Button>
          </div>

          {shared.errorMessage ? (
            <p className="rounded-[1.2rem] bg-rose-100 px-4 py-3 text-sm font-medium text-rose-700">
              {shared.errorMessage}
            </p>
          ) : null}

          <StatusPanel statusMessage={shared.statusMessage} />
        </div>
      ) : (
        <div className={panelClassName} id="auth">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Authenticate
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              Log in to manage card backups
            </h2>
          </div>
          <SignedOutForm
            email={shared.email}
            errorMessage={shared.errorMessage}
            isHydrated={shared.isHydrated}
            isSubmitting={shared.isSubmitting}
            mode={shared.mode}
            olderPasswords={shared.olderPasswords}
            onSubmit={() => {
              shared.handleSubmit().catch(() => {
                // The shared form surfaces submit failures through state.
              });
            }}
            password={shared.password}
            requiredOlderKeks={shared.requiredOlderKeks}
            setEmail={shared.setEmail}
            setMode={shared.setMode}
            setOlderPasswords={shared.setOlderPasswords}
            setPassword={shared.setPassword}
          />
        </div>
      )}
    </PageShell>
  );
}

function toBackupFolderNote(folder: {
  createdAt: string;
  id: string;
  parentFolderId: string | null;
  title: string;
  updatedAt: string;
}): ImportExportSuiteNote {
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