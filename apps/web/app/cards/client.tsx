'use client';

import Image from 'next/image';
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
  type ImportExportSuiteNote,
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
} from '../shared/session-page-helpers';

type DecryptedCard = {
  createdAt: string;
  id: string;
  lastDoneAt: string | null;
  question: string;
  updatedAt: string;
};

export function CardsPageClient() {
  const [cardQuestion, setCardQuestion] = useState('');
  const [cards, setCards] = useState<DecryptedCard[]>([]);
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importInspection, setImportInspection] =
    useState<ImportExportSuiteInspection | null>(null);
  const [importPayload, setImportPayload] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isExportingCards, setIsExportingCards] = useState(false);
  const [isImportingCards, setIsImportingCards] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const selectedCardIdRef = useRef<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const applySelectedCard = useCallback((card: DecryptedCard | null) => {
    const nextSelectedCardId = card?.id ?? null;

    selectedCardIdRef.current = nextSelectedCardId;
    setSelectedCardId(nextSelectedCardId);
    setCardQuestion(card?.question ?? '');
  }, []);

  const applyOfflineSnapshot = useCallback(() => {
    const nextCards = sortCards(getOfflineNoteSnapshot().map(toCardRecord));

    setCards(nextCards);
    applySelectedCard(pickSelectedCard(nextCards, selectedCardIdRef.current));
  }, [applySelectedCard]);

  const shared = useSessionPageState({
    onAuthenticated: async ({ linkedKeks, mode, session, trimmedBackendUrl }) => {
      const syncedNotes = await syncOfflineNotes({
        linkedKeks,
        nextSession: session,
        runWithSessionRetry: shared.runWithSessionRetry,
        trimmedBackendUrl,
      });
      const syncedCards = sortCards(syncedNotes.map(toCardRecord));

      setCards(syncedCards);
      applySelectedCard(syncedCards[0] ?? null);

      return buildPostLoginNoteMessage(mode, syncedCards.length);
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
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);

    return () => {
      clearInterval(timer);
    };
  }, []);

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
        const syncedCards = sortCards(syncedNotes.map(toCardRecord));

        setCards(syncedCards);
        applySelectedCard(pickSelectedCard(syncedCards, selectedCardIdRef.current));
        setStatusMessage(buildInitialNoteSyncMessage(syncedCards.length));
      }).catch((error) => {
        const cardCount = getOfflineNoteSnapshot().length;

        setStatusMessage(buildOfflineSyncFailureMessage(cardCount, error));
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [
    applySelectedCard,
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
          refreshSession(session, trimmedBackendUrl).catch(() => {
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
            const syncedCards = sortCards(syncedNotes.map(toCardRecord));

            setCards(syncedCards);
            applySelectedCard(pickSelectedCard(syncedCards, selectedCardIdRef.current));
          }).catch((error) => {
            setStatusMessage(
              error instanceof Error
                ? error.message
                : 'Unable to sync encrypted cards after the realtime update.',
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
          error instanceof Error ? error.message : 'Unable to connect card realtime updates.',
        );
      });
    }
  }, [
    applySelectedCard,
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
        const syncedCards = sortCards(syncedNotes.map(toCardRecord));

        setCards(syncedCards);
        applySelectedCard(pickSelectedCard(syncedCards, selectedCardIdRef.current));
        setStatusMessage('Connection restored. Synced offline card changes.');
      }).catch((error) => {
        setStatusMessage(
          error instanceof Error ? error.message : 'Unable to sync encrypted cards.',
        );
      });
    };

    globalThis.addEventListener('online', handleOnline);

    return () => {
      globalThis.removeEventListener('online', handleOnline);
    };
  }, [
    applySelectedCard,
    backendUrl,
    isHydrated,
    linkedKeks,
    runWithSessionRetry,
    session,
    setStatusMessage,
  ]);

  function handleCreateCard() {
    shared.setErrorMessage(null);
    applySelectedCard(null);
    shared.setStatusMessage('Creating a new encrypted card draft.');
  }

  function handleSelectCard(cardId: string) {
    const nextCard = cards.find((card) => card.id === cardId) ?? null;

    applySelectedCard(nextCard);
    shared.setStatusMessage(nextCard ? `Selected "${nextCard.question || 'Untitled card'}".` : '');
  }

  async function handleSaveCard() {
    const trimmedQuestion = cardQuestion.trim();

    if (!trimmedQuestion) {
      shared.setErrorMessage('Enter a question before saving the card.');
      return;
    }

    shared.setErrorMessage(null);

    try {
      const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;
      const savedCard = toCardRecord(await webOfflineNotesProvider.saveNote({
        content: selectedCard?.lastDoneAt ?? '',
        id: selectedCardId ?? undefined,
        title: trimmedQuestion,
      }));
      const actionLabel = selectedCardId ? 'Updated' : 'Created';

      applySelectedCard(savedCard);

      if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
        shared.setStatusMessage(
          `${actionLabel} "${savedCard.question || 'Untitled card'}" locally. Sync pending.`,
        );
        return;
      }

      try {
        const syncedCards = sortCards((await syncOfflineNotes({
          linkedKeks: shared.linkedKeks,
          nextSession: shared.session,
          runWithSessionRetry: shared.runWithSessionRetry,
          trimmedBackendUrl: shared.backendUrl.trim(),
        })).map(toCardRecord));

        setCards(syncedCards);
        shared.setStatusMessage(`${actionLabel} "${savedCard.question || 'Untitled card'}".`);
      } catch (error) {
        shared.setErrorMessage(
          error instanceof Error ? error.message : 'Unable to sync the encrypted card.',
        );
        shared.setStatusMessage(
          `${actionLabel} "${savedCard.question || 'Untitled card'}" locally. Sync pending.`,
        );
      }
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to save the encrypted card.',
      );
    }
  }

  async function handleDeleteCard() {
    if (!selectedCardId) {
      applySelectedCard(null);
      shared.setStatusMessage('Cleared the local card draft.');
      return;
    }

    shared.setErrorMessage(null);

    try {
      const deletedCard = cards.find((card) => card.id === selectedCardId) ?? null;

      await webOfflineNotesProvider.deleteNote(selectedCardId);

      if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
        shared.setStatusMessage(
          `Deleted "${deletedCard?.question || 'Untitled card'}" locally. Sync pending.`,
        );
        return;
      }

      try {
        const syncedCards = sortCards((await syncOfflineNotes({
          linkedKeks: shared.linkedKeks,
          nextSession: shared.session,
          runWithSessionRetry: shared.runWithSessionRetry,
          trimmedBackendUrl: shared.backendUrl.trim(),
        })).map(toCardRecord));

        setCards(syncedCards);
        shared.setStatusMessage(`Deleted "${deletedCard?.question || 'Untitled card'}".`);
      } catch (error) {
        shared.setErrorMessage(
          error instanceof Error ? error.message : 'Unable to sync the deleted card.',
        );
        shared.setStatusMessage(
          `Deleted "${deletedCard?.question || 'Untitled card'}" locally. Sync pending.`,
        );
      }
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to delete the encrypted card.',
      );
    }
  }

  async function handleMarkNow(cardId: string) {
    const card = cards.find((entry) => entry.id === cardId) ?? null;

    if (!card) {
      return;
    }

    shared.setErrorMessage(null);

    try {
      const savedCard = toCardRecord(await webOfflineNotesProvider.saveNote({
        content: new Date().toISOString(),
        id: card.id,
        title: card.question,
      }));

      if (selectedCardIdRef.current === savedCard.id) {
        applySelectedCard(savedCard);
      }

      if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
        shared.setStatusMessage(`Updated "${savedCard.question}" locally. Sync pending.`);
        return;
      }

      try {
        const syncedCards = sortCards((await syncOfflineNotes({
          linkedKeks: shared.linkedKeks,
          nextSession: shared.session,
          runWithSessionRetry: shared.runWithSessionRetry,
          trimmedBackendUrl: shared.backendUrl.trim(),
        })).map(toCardRecord));

        setCards(syncedCards);
        shared.setStatusMessage(`Updated "${savedCard.question}" to now.`);
      } catch (error) {
        shared.setErrorMessage(
          error instanceof Error ? error.message : 'Unable to sync the updated card.',
        );
        shared.setStatusMessage(`Updated "${savedCard.question}" locally. Sync pending.`);
      }
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to update the card timestamp.',
      );
    }
  }

  async function handleExportCards() {
    if (cards.length === 0) {
      shared.setStatusMessage('Create or sync at least one card before exporting JSON.');
      return;
    }

    shared.setErrorMessage(null);
    setIsExportingCards(true);

    try {
      const cardLabel = `card${cards.length === 1 ? '' : 's'}`;
      const protectionLabel = exportPassword ? 'password-protected JSON' : 'cleartext JSON';
      const serialized = await exportImportExportSuite(
        cards.map((card) => toBackupCard(card)),
        exportPassword
          ? {
              password: exportPassword,
            }
          : undefined,
      );
      const filename = buildImportExportSuiteFilename(new Date().toISOString());

      downloadTextFile(filename, serialized, 'application/json');
      setExportPassword('');
      shared.setStatusMessage(`Exported ${cards.length} ${cardLabel} as ${protectionLabel}.`);
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to export the cards as JSON.',
      );
    } finally {
      setIsExportingCards(false);
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

  async function handleImportCards() {
    if (!importPayload) {
      shared.setErrorMessage('Choose a JSON import file before importing cards.');
      return;
    }

    shared.setErrorMessage(null);
    setIsImportingCards(true);

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
        shared.setStatusMessage('The selected import file does not contain any cards.');
        return;
      }

      let createdCount = 0;
      let updatedCount = 0;
      let syncPending = false;

      for (const importedNote of importedNotes) {
        const existingCard = cards.find((card) => card.id === importedNote.id) ?? null;

        await webOfflineNotesProvider.saveNote({
          content: normalizeLastDoneAt(importedNote.content) ?? '',
          id: importedNote.id,
          title: importedNote.title,
        });

        if (existingCard) {
          updatedCount += 1;
        } else {
          createdCount += 1;
        }
      }

      if (shared.session && shared.linkedKeks.length > 0 && shared.backendUrl.trim()) {
        try {
          const syncedCards = sortCards((await syncOfflineNotes({
            linkedKeks: shared.linkedKeks,
            nextSession: shared.session,
            runWithSessionRetry: shared.runWithSessionRetry,
            trimmedBackendUrl: shared.backendUrl.trim(),
          })).map(toCardRecord));

          setCards(syncedCards);
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
      setIsImportingCards(false);
    }
  }

  return (
    <PageShell title="When did I last...">
      {shared.session ? (
        <div className="grid w-full gap-4">
          <div className={panelClassName} id="cards">
            <div className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <Image
                  alt="When Did I Last mark"
                  className="rounded-[1.5rem]"
                  height={84}
                  src="/wdil-mark.png"
                  width={84}
                />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Cards ({cards.length})
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                    Track recurring life admin.
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-foreground/72">
                    Signed in as {shared.session.user.email}. Tap a card to edit it, or hit Now when you just did the thing.
                  </p>
                </div>
              </div>
              <Button onClick={handleCreateCard} size="lg" variant="outline">
                New card
              </Button>
            </div>

            <div className="mt-5 grid gap-3">
              {cards.length === 0 ? (
                <p className="rounded-[1.4rem] border border-dashed border-border/70 bg-background/75 px-4 py-5 text-sm text-foreground/65">
                  No encrypted cards yet.
                </p>
              ) : (
                cards.map((card) => {
                  const isActive = card.id === selectedCardId;

                  return (
                    <div
                      className={`grid gap-3 rounded-[1.5rem] border px-4 py-4 transition sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
                        isActive
                          ? 'border-[#47474d] bg-white shadow-sm'
                          : 'border-border/60 bg-white/85 hover:border-border'
                      }`}
                      key={card.id}
                    >
                      <button
                        className="grid gap-3 text-left"
                        onClick={() => handleSelectCard(card.id)}
                        type="button"
                      >
                        <span className="text-lg text-foreground">{appendQuestionMark(card.question)}</span>
                        <span className="text-xl font-semibold text-foreground/85">
                          {formatElapsedTime(card.lastDoneAt, now)}
                        </span>
                        <span className="text-xs uppercase tracking-[0.18em] text-foreground/45">
                          Updated {formatTimestamp(card.updatedAt)}
                        </span>
                      </button>
                      <Button
                        onClick={() => {
                          void handleMarkNow(card.id);
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Now
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className={panelClassName} id="editor">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Editor
            </p>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                When did I last...
              </span>
                <div className="flex items-center rounded-[1.5rem] border border-border bg-background/80 px-2 py-1 transition focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
                <input
                  autoComplete="off"
                  className="min-w-0 grow bg-transparent px-3 py-3 text-base text-foreground outline-none"
                  onChange={(event) => setCardQuestion(event.target.value)}
                  placeholder="water the plants"
                  type="text"
                  value={cardQuestion}
                />
                <span className="rounded-full bg-muted px-3 py-2 text-lg font-semibold text-foreground/70">
                  ?
                </span>
              </div>
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                onClick={() => {
                  void handleSaveCard();
                }}
                size="lg"
              >
                {selectedCardId ? 'Save card' : 'Create card'}
              </Button>
              <Button
                onClick={() => {
                  void handleDeleteCard();
                }}
                size="lg"
                variant="outline"
              >
                {selectedCardId ? 'Delete card' : 'Clear draft'}
              </Button>
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
                disabled={isExportingCards || cards.length === 0}
                onClick={() => {
                  void handleExportCards();
                }}
                size="lg"
                variant="outline"
              >
                {isExportingCards ? 'Exporting JSON...' : 'Export JSON'}
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
                  {importFileName} · {importInspection.noteCount} card{importInspection.noteCount === 1 ? '' : 's'} · {importInspection.encrypted ? 'encrypted' : 'cleartext'}
                </p>
              ) : (
                <p>No import file selected.</p>
              )}
            </div>
            <Button
              disabled={isImportingCards || !importPayload}
              onClick={() => {
                void handleImportCards();
              }}
              size="lg"
            >
              {isImportingCards ? 'Importing JSON...' : 'Import selected JSON'}
            </Button>
          </div>

          {shared.errorMessage ? (
            <p className="rounded-[1.2rem] bg-rose-100 px-4 py-3 text-sm font-medium text-rose-700">
              {shared.errorMessage}
            </p>
          ) : null}

          <StatusPanel selectedNoteId={selectedCardId} statusMessage={shared.statusMessage} />
        </div>
      ) : (
        <div className={panelClassName} id="auth">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Authenticate
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">
              Log in to open your cards
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

function toCardRecord(note: {
  content: string;
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
}): DecryptedCard {
  return {
    createdAt: note.createdAt,
    id: note.id,
    lastDoneAt: normalizeLastDoneAt(note.content),
    question: note.title,
    updatedAt: note.updatedAt,
  };
}

function toBackupCard(card: DecryptedCard): ImportExportSuiteNote {
  return {
    content: card.lastDoneAt ?? '',
    createdAt: card.createdAt,
    id: card.id,
    title: card.question,
    updatedAt: card.updatedAt,
  };
}

function normalizeLastDoneAt(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  return Number.isNaN(Date.parse(trimmedValue)) ? null : trimmedValue;
}

function sortCards(cards: DecryptedCard[]) {
  return [...cards].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function pickSelectedCard(cards: DecryptedCard[], selectedCardId: string | null) {
  return cards.find((card) => card.id === selectedCardId) ?? cards[0] ?? null;
}

function appendQuestionMark(question: string) {
  const trimmedQuestion = question.trim();

  return trimmedQuestion.endsWith('?') ? trimmedQuestion : `${trimmedQuestion}?`;
}

function formatElapsedTime(lastDoneAt: string | null, now: number) {
  if (!lastDoneAt) {
    return 'never';
  }

  const parsedDate = Date.parse(lastDoneAt);

  if (Number.isNaN(parsedDate)) {
    return 'never';
  }

  const deltaSeconds = Math.max(Math.floor((now - parsedDate) / 1000), 0);
  const minutes = Math.floor(deltaSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${hours % 24} hour${hours % 24 === 1 ? '' : 's'} and ${days} day${days === 1 ? '' : 's'} ago`;
  }

  if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'} and ${minutes % 60} minute${minutes % 60 === 1 ? '' : 's'} ago`;
  }

  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  return 'just now';
}
