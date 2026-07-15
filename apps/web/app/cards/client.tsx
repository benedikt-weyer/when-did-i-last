'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { subscribeToNoteEvents } from '@repo/realtime';
import { Check, Pencil, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import {
  PageShell,
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
  buildInitialNoteSyncMessage,
  buildOfflineSyncFailureMessage,
  buildPostLoginNoteMessage,
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
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const selectedCardIdRef = useRef<string | null>(null);

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

  async function handleCreateCard() {
    shared.setErrorMessage(null);

    try {
      const newCard = toCardRecord(await webOfflineNotesProvider.saveNote({
        content: '',
        title: '',
      }));

      setCards((currentCards) => sortCards([...currentCards, newCard]));
      applySelectedCard(newCard);
      setEditingCardId(newCard.id);

      if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
        shared.setStatusMessage('Created a new encrypted card locally. Sync pending.');
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
        shared.setStatusMessage('Created a new encrypted card.');
      } catch (error) {
        shared.setErrorMessage(
          error instanceof Error ? error.message : 'Unable to sync the encrypted card.',
        );
        shared.setStatusMessage('Created a new encrypted card locally. Sync pending.');
      }
    } catch (error) {
      shared.setErrorMessage(
        error instanceof Error ? error.message : 'Unable to create the encrypted card.',
      );
    }
  }

  function handleStartEdit(card: DecryptedCard) {
    applySelectedCard(card);
    setEditingCardId(card.id);
    shared.setErrorMessage(null);
  }

  function handleCancelEdit(card: DecryptedCard) {
    setCardQuestion(card.question);
    setEditingCardId(null);
  }

  async function handleSaveCard(cardId: string) {
    const selectedCard = cards.find((card) => card.id === cardId) ?? null;

    if (!selectedCard) {
      return;
    }

    shared.setErrorMessage(null);

    try {
      const savedCard = toCardRecord(await webOfflineNotesProvider.saveNote({
        content: selectedCard?.lastDoneAt ?? '',
        id: selectedCard.id,
        title: cardQuestion.trim(),
      }));
      const actionLabel = 'Updated';

      applySelectedCard(savedCard);
      setEditingCardId(null);

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

  async function handleDeleteCard(cardId: string) {
    shared.setErrorMessage(null);

    try {
      const deletedCard = cards.find((card) => card.id === cardId) ?? null;

      await webOfflineNotesProvider.deleteNote(cardId);
      setCards((currentCards) => currentCards.filter((card) => card.id !== cardId));
      if (selectedCardIdRef.current === cardId) {
        applySelectedCard(null);
      }
      if (editingCardId === cardId) {
        setEditingCardId(null);
      }

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

  return (
    <PageShell title="When did I last...">
      {shared.session ? (
        <div className="grid w-full gap-4">
          <div className={panelClassName} id="cards">
            <div className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Cards ({cards.length})
              </p>
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
                  const isEditing = card.id === editingCardId;

                  return (
                    <div
                      className={`grid gap-3 rounded-[1.5rem] border px-4 py-4 transition sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
                        isEditing
                          ? 'border-primary/60 bg-card shadow-sm ring-1 ring-primary/15'
                          : 'border-border/60 bg-card/85 hover:border-border hover:bg-card'
                      }`}
                      key={card.id}
                    >
                      <div className="grid gap-3">
                        {isEditing ? (
                          <label className="flex items-center rounded-[1.5rem] border border-border bg-background/80 px-2 py-1 transition focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
                            <input
                              autoComplete="off"
                              autoFocus
                              className="min-w-0 grow bg-transparent px-3 py-3 text-base text-foreground outline-none"
                              onChange={(event) => setCardQuestion(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void handleSaveCard(card.id);
                                }
                                if (event.key === 'Escape') {
                                  handleCancelEdit(card);
                                }
                              }}
                              placeholder="water the plants"
                              type="text"
                              value={cardQuestion}
                            />
                            <span className="rounded-full bg-muted px-3 py-2 text-lg font-semibold text-foreground/70">
                              ?
                            </span>
                          </label>
                        ) : (
                          <span className="text-lg text-foreground">{appendQuestionMark(card.question)}</span>
                        )}
                        <span className="text-xl font-semibold text-foreground/85">
                          {formatElapsedTime(card.lastDoneAt, now)}
                        </span>
                        <span className="text-xs uppercase tracking-[0.18em] text-foreground/45">
                          Updated {formatTimestamp(card.updatedAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 self-start sm:self-center">
                        {isEditing ? (
                          <>
                            <Button aria-label="Save card" onClick={() => { void handleSaveCard(card.id); }} size="icon" title="Save card">
                              <Check />
                            </Button>
                            <Button aria-label="Cancel editing" onClick={() => handleCancelEdit(card)} size="icon" title="Cancel editing" variant="outline">
                              <X />
                            </Button>
                          </>
                        ) : (
                          <Button aria-label="Edit card" onClick={() => handleStartEdit(card)} size="icon" title="Edit card" variant="outline">
                            <Pencil />
                          </Button>
                        )}
                        <Button
                          aria-label="Mark card as done now"
                          onClick={() => { void handleMarkNow(card.id); }}
                          size="sm"
                          title="Mark as done now"
                          variant="outline"
                        >
                          Now
                        </Button>
                        <Button aria-label="Remove card" onClick={() => { void handleDeleteCard(card.id); }} size="icon" title="Remove card" variant="ghost">
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
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
