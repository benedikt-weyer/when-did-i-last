'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { subscribeToNoteEvents } from '@repo/realtime';
import {
  exportImportExportSuite,
  importImportExportSuite,
  inspectImportExportSuite,
  type ImportExportSuiteInspection,
} from '@repo/import-export-suite/web';

import { Button } from '@/components/ui/button';

import {
  PageShell,
  LabeledInput,
  SignedOutForm,
  StatusPanel,
  panelClassName,
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
  formatTimestamp,
  toBackupNote,
  toNoteRecord,
  type DecryptedNote,
} from '../shared/session-page-helpers';

export function NotesPageClient() {
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [notes, setNotes] = useState<DecryptedNote[]>([]);
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importInspection, setImportInspection] =
    useState<ImportExportSuiteInspection | null>(null);
  const [importPayload, setImportPayload] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isExportingNotes, setIsExportingNotes] = useState(false);
  const [isImportingNotes, setIsImportingNotes] = useState(false);
  const selectedNoteIdRef = useRef<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const applySelectedNote = useCallback((note: DecryptedNote | null) => {
    const nextSelectedNoteId = note?.id ?? null;

    selectedNoteIdRef.current = nextSelectedNoteId;
    setSelectedNoteId(nextSelectedNoteId);
    setNoteTitle(note?.title ?? '');
    setNoteContent(note?.content ?? '');
  }, []);

  const applyOfflineSnapshot = useCallback(() => {
    const nextNotes = getOfflineNoteSnapshot();

    setNotes(nextNotes);

    const nextSelectedNote =
      nextNotes.find((note) => note.id === selectedNoteIdRef.current) ??
      nextNotes[0] ??
      null;

    applySelectedNote(nextSelectedNote);
  }, [applySelectedNote]);

  const shared = useSessionPageState({
    onAuthenticated: async ({ linkedKeks, mode, session, trimmedBackendUrl }) => {
      const syncedNotes = await syncOfflineNotes({
        linkedKeks,
        nextSession: session,
        runWithSessionRetry: shared.runWithSessionRetry,
        trimmedBackendUrl,
      });

      setNotes(syncedNotes);
      applySelectedNote(syncedNotes[0] ?? null);

      return buildPostLoginNoteMessage(mode, syncedNotes.length);
    },
  });
  const {
    backendUrl,
    isHydrated,
    linkedKeks,
    refreshSession,
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

    void webOfflineNotesProvider.initialize().then(() => {
      if (!isCancelled) {
        applyOfflineSnapshot();
      }
    }).catch((error) => {
      if (!isCancelled) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Unable to initialize the offline notes store.',
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
        setNotes(syncedNotes);
        const nextSelectedNote =
          syncedNotes.find((note) => note.id === selectedNoteIdRef.current) ??
          syncedNotes[0] ??
          null;

        applySelectedNote(nextSelectedNote);
        setStatusMessage(buildInitialNoteSyncMessage(syncedNotes.length));
      }).catch((error) => {
        const noteCount = getOfflineNoteSnapshot().length;

        setStatusMessage(buildOfflineSyncFailureMessage(noteCount, error));
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [
    applySelectedNote,
    backendUrl,
    isHydrated,
    linkedKeks,
    runWithSessionRetry,
    session,
    setStatusMessage,
  ]);

  useEffect(() => {
    if (!isHydrated || !session || linkedKeks.length === 0) {
      return;
    }

    const trimmedBackendUrl = backendUrl.trim();

    try {
      const subscription = subscribeToNoteEvents({
        accessToken: session.token,
        baseUrl: trimmedBackendUrl,
        onError: (error) => {
          void refreshSession(session, trimmedBackendUrl).catch(() => {
            setStatusMessage(error.message);
          });
        },
        onEvent: () => {
          void syncOfflineNotes({
            linkedKeks,
            nextSession: session,
            runWithSessionRetry,
            trimmedBackendUrl,
          }).then((syncedNotes) => {
            setNotes(syncedNotes);
            const nextSelectedNote =
              syncedNotes.find((note) => note.id === selectedNoteIdRef.current) ??
              syncedNotes[0] ??
              null;

            applySelectedNote(nextSelectedNote);
          }).catch((error) => {
            setStatusMessage(
              error instanceof Error
                ? error.message
                : 'Unable to sync encrypted notes after the realtime update.',
            );
          });
        },
      });

      return () => {
        subscription.close();
      };
    } catch (error) {
      queueMicrotask(() => {
        setStatusMessage(
          error instanceof Error ? error.message : 'Unable to connect note realtime updates.',
        );
      });
    }
  }, [
    applySelectedNote,
    backendUrl,
    isHydrated,
    linkedKeks,
    refreshSession,
    runWithSessionRetry,
    session,
    setStatusMessage,
  ]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const handleOnline = () => {
      if (!session || linkedKeks.length === 0) {
        return;
      }

      void syncOfflineNotes({
        linkedKeks,
        nextSession: session,
        runWithSessionRetry,
        trimmedBackendUrl: backendUrl.trim(),
      }).then((syncedNotes) => {
        setNotes(syncedNotes);
        const nextSelectedNote =
          syncedNotes.find((note) => note.id === selectedNoteIdRef.current) ??
          syncedNotes[0] ??
          null;

        applySelectedNote(nextSelectedNote);
        setStatusMessage('Connection restored. Synced offline note changes.');
      }).catch((error) => {
        setStatusMessage(
          error instanceof Error ? error.message : 'Unable to sync encrypted notes.',
        );
      });
    };

    globalThis.addEventListener('online', handleOnline);

    return () => {
      globalThis.removeEventListener('online', handleOnline);
    };
  }, [
    applySelectedNote,
    backendUrl,
    isHydrated,
    linkedKeks,
    runWithSessionRetry,
    session,
    setStatusMessage,
  ]);

  function handleCreateNote() {
    shared.setErrorMessage(null);
    applySelectedNote(null);
    shared.setStatusMessage('Creating a new encrypted note draft.');
  }

  function handleSelectNote(noteId: string) {
    const nextNote = notes.find((note) => note.id === noteId) ?? null;

    applySelectedNote(nextNote);
    shared.setStatusMessage(nextNote ? `Selected "${nextNote.title || 'Untitled note'}".` : '');
  }

  async function handleSaveNote() {
    shared.setErrorMessage(null);

    try {
      const savedNote = toNoteRecord(await webOfflineNotesProvider.saveNote({
        content: noteContent,
        id: selectedNoteId ?? undefined,
        title: noteTitle,
      }));
      const actionLabel = selectedNoteId ? 'Updated' : 'Created';

      applySelectedNote(savedNote);

      if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
        shared.setStatusMessage(
          `${actionLabel} "${savedNote.title || 'Untitled note'}" locally. Sync pending.`,
        );
        return;
      }

      try {
        const syncedNotes = await syncOfflineNotes({
          linkedKeks: shared.linkedKeks,
          nextSession: shared.session,
          runWithSessionRetry: shared.runWithSessionRetry,
          trimmedBackendUrl: shared.backendUrl.trim(),
        });

        setNotes(syncedNotes);
        shared.setStatusMessage(`${actionLabel} "${savedNote.title || 'Untitled note'}".`);
      } catch (error) {
        shared.setErrorMessage(
          error instanceof Error ? error.message : 'Unable to sync the encrypted note.',
        );
        shared.setStatusMessage(
          `${actionLabel} "${savedNote.title || 'Untitled note'}" locally. Sync pending.`,
        );
      }
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to save the encrypted note.',
      );
    }
  }

  async function handleClearNote() {
    if (!selectedNoteId) {
      applySelectedNote(null);
      shared.setStatusMessage('Cleared the local note draft.');
      return;
    }

    shared.setErrorMessage(null);

    try {
      const deletedNote = notes.find((note) => note.id === selectedNoteId) ?? null;

      await webOfflineNotesProvider.deleteNote(selectedNoteId);

      if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
        shared.setStatusMessage(
          `Deleted "${deletedNote?.title || 'Untitled note'}" locally. Sync pending.`,
        );
        return;
      }

      try {
        const syncedNotes = await syncOfflineNotes({
          linkedKeks: shared.linkedKeks,
          nextSession: shared.session,
          runWithSessionRetry: shared.runWithSessionRetry,
          trimmedBackendUrl: shared.backendUrl.trim(),
        });

        setNotes(syncedNotes);
        shared.setStatusMessage(`Deleted "${deletedNote?.title || 'Untitled note'}".`);
      } catch (error) {
        shared.setErrorMessage(
          error instanceof Error ? error.message : 'Unable to sync the deleted note.',
        );
        shared.setStatusMessage(
          `Deleted "${deletedNote?.title || 'Untitled note'}" locally. Sync pending.`,
        );
      }
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to delete the encrypted note.',
      );
    }
  }

  async function handleExportNotes() {
    if (notes.length === 0) {
      shared.setStatusMessage('Create or sync at least one note before exporting JSON.');
      return;
    }

    shared.setErrorMessage(null);
    setIsExportingNotes(true);

    try {
      const noteLabel = `note${notes.length === 1 ? '' : 's'}`;
      const protectionLabel = exportPassword ? 'password-protected JSON' : 'cleartext JSON';
      const serialized = await exportImportExportSuite(
        notes.map((note) => toBackupNote(note)),
        exportPassword
          ? {
              password: exportPassword,
            }
          : undefined,
      );
      const filename = buildImportExportSuiteFilename(new Date().toISOString());

      downloadTextFile(filename, serialized, 'application/json');
      setExportPassword('');
      shared.setStatusMessage(`Exported ${notes.length} ${noteLabel} as ${protectionLabel}.`);
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to export the notes as JSON.',
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
      shared.setErrorMessage('Choose a JSON import file before importing notes.');
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
        shared.setStatusMessage('The selected import file does not contain any notes.');
        return;
      }

      let createdCount = 0;
      let updatedCount = 0;
      let syncPending = false;

      for (const importedNote of importedNotes) {
        const existingNote = notes.find((note) => note.id === importedNote.id) ?? null;

        await webOfflineNotesProvider.saveNote({
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
            error instanceof Error ? error.message : 'Unable to sync the imported notes.',
          );
        }
      } else {
        syncPending = true;
      }

      setImportPayload(null);
      setImportFileName('');
      setImportInspection(null);
      setImportPassword('');
      shared.setStatusMessage(
        syncPending
          ? `${buildImportSummary(createdCount, updatedCount)} Sync pending.`
          : buildImportSummary(createdCount, updatedCount),
      );
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to import the JSON export.',
      );
    } finally {
      setIsImportingNotes(false);
    }
  }

  return (
    <PageShell title="Encrypted notes">
      {shared.session ? (
        <div className="grid w-full gap-4">
          <div className={panelClassName} id="notes">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Notes ({notes.length})
              </p>
              <Button onClick={handleCreateNote} size="sm" variant="outline">
                New note
              </Button>
            </div>
            <div className="overflow-x-auto rounded-[1.2rem] border border-border/60 bg-card">
              {notes.length === 0 ? (
                <p className="px-4 py-5 text-sm text-foreground/60">
                  No encrypted notes yet.
                </p>
              ) : (
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Title</th>
                      <th className="px-4 py-3 font-semibold">Preview</th>
                      <th className="px-4 py-3 font-semibold">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notes.map((note) => {
                      const isActive = note.id === selectedNoteId;

                      return (
                        <tr
                          className={`cursor-pointer border-t border-border/50 transition ${
                            isActive ? 'bg-primary/10' : 'hover:bg-primary/5'
                          }`}
                          key={note.id}
                          onClick={() => handleSelectNote(note.id)}
                        >
                          <td className="max-w-[12rem] truncate px-4 py-3 font-semibold text-foreground">
                            {note.title || 'Untitled note'}
                          </td>
                          <td className="max-w-[18rem] truncate px-4 py-3 text-foreground/70">
                            {note.content || 'No content yet'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-foreground/60">
                            {formatTimestamp(note.updatedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="grid gap-3">
              <LabeledInput
                autoComplete="off"
                label="Title"
                onChange={setNoteTitle}
                placeholder="Untitled note"
                type="text"
                value={noteTitle}
              />
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Content
                </span>
                <textarea
                  className="min-h-44 rounded-[1.5rem] border border-border bg-card px-4 py-4 text-base text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                  onChange={(event) => setNoteContent(event.target.value)}
                  placeholder="Write a note"
                  value={noteContent}
                />
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button onClick={() => {
                  void handleSaveNote();
                }} size="lg">
                  {selectedNoteId ? 'Update note' : 'Create note'}
                </Button>
                <Button onClick={() => {
                  void handleClearNote();
                }} size="lg" variant="outline">
                  {selectedNoteId ? 'Delete note' : 'Clear draft'}
                </Button>
              </div>
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
                disabled={isExportingNotes || notes.length === 0}
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
                  {importFileName} · {importInspection.noteCount} note{importInspection.noteCount === 1 ? '' : 's'} · {importInspection.encrypted ? 'encrypted' : 'cleartext'}
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

          <StatusPanel selectedNoteId={selectedNoteId} statusMessage={shared.statusMessage} />
        </div>
      ) : (
        <div className={panelClassName} id="auth">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Authenticate
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              Log in to open your notes
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
              void shared.handleSubmit();
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