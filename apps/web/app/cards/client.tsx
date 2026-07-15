'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { subscribeToNoteEvents } from '@repo/realtime';
import {
  MAX_FOLDER_DEPTH,
  parseNoteOrganization,
  serializeCardOrganization,
} from '@repo/offline-provider';
import { decryptStringWithAsymmetricKek, encryptStringWithAsymmetricKeks } from '@repo/e2ee-auth/web';
import { Check, FolderPlus, Pencil, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fetchLinkedPrincipals } from '@/lib/auth-api';
import { fetchFolders, saveFolder } from '@/lib/folder-api';

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
  folderId: string | null;
  lastDoneAt: string | null;
  question: string;
  updatedAt: string;
};

type DecryptedFolder = {
  createdAt: string;
  id: string;
  parentFolderId: string | null;
  title: string;
  updatedAt: string;
};

export function CardsPageClient() {
  const [cardQuestion, setCardQuestion] = useState('');
  const [cards, setCards] = useState<DecryptedCard[]>([]);
  const [folders, setFolders] = useState<DecryptedFolder[]>([]);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderTitle, setFolderTitle] = useState('');
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
    const records = toRecords(getOfflineNoteSnapshot());
    const nextCards = sortCards(records.cards);

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
      const records = toRecords(syncedNotes);
      const syncedCards = sortCards(records.cards);

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
        const records = toRecords(syncedNotes);
        const syncedCards = sortCards(records.cards);

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
    if (!isHydrated || !session || linkedKeks.length === 0 || !backendUrl.trim()) return;
    void refreshFolders().catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to load encrypted folders.');
    });
  // Folder loading is intentionally driven by authentication and key changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, isHydrated, linkedKeks, session]);

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
            const records = toRecords(syncedNotes);
            const syncedCards = sortCards(records.cards);

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
        const records = toRecords(syncedNotes);
        const syncedCards = sortCards(records.cards);

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
        content: serializeCardOrganization({ folderId: null, lastDoneAt: null }),
        title: '',
      }));

      if (!newCard) {
        throw new Error('The local note store returned an invalid card.');
      }

      setCards((currentCards) => sortCards([...currentCards, newCard]));
      applySelectedCard(newCard);
      setEditingCardId(newCard.id);

      if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
        shared.setStatusMessage('Created a new encrypted card locally. Sync pending.');
        return;
      }

      try {
        const syncedNotes = await syncOfflineNotes({
          linkedKeks: shared.linkedKeks,
          nextSession: shared.session,
          runWithSessionRetry: shared.runWithSessionRetry,
          trimmedBackendUrl: shared.backendUrl.trim(),
        });

        const records = toRecords(syncedNotes);

        setCards(sortCards(records.cards));
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
        content: serializeCardOrganization({
          folderId: selectedCard.folderId,
          lastDoneAt: selectedCard.lastDoneAt,
        }),
        id: selectedCard.id,
        title: cardQuestion.trim(),
      }));
      if (!savedCard) {
        throw new Error('The local note store returned an invalid card.');
      }
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
        const syncedNotes = await syncOfflineNotes({
          linkedKeks: shared.linkedKeks,
          nextSession: shared.session,
          runWithSessionRetry: shared.runWithSessionRetry,
          trimmedBackendUrl: shared.backendUrl.trim(),
        });
        const records = toRecords(syncedNotes);

        setCards(sortCards(records.cards));
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
        const syncedNotes = await syncOfflineNotes({
          linkedKeks: shared.linkedKeks,
          nextSession: shared.session,
          runWithSessionRetry: shared.runWithSessionRetry,
          trimmedBackendUrl: shared.backendUrl.trim(),
        });
        const records = toRecords(syncedNotes);

        setCards(sortCards(records.cards));
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
        content: serializeCardOrganization({
          folderId: card.folderId,
          lastDoneAt: new Date().toISOString(),
        }),
        id: card.id,
        title: card.question,
      }));
      if (!savedCard) {
        throw new Error('The local note store returned an invalid card.');
      }

      if (selectedCardIdRef.current === savedCard.id) {
        applySelectedCard(savedCard);
      }

      if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
        shared.setStatusMessage(`Updated "${savedCard.question}" locally. Sync pending.`);
        return;
      }

      try {
        const syncedNotes = await syncOfflineNotes({
          linkedKeks: shared.linkedKeks,
          nextSession: shared.session,
          runWithSessionRetry: shared.runWithSessionRetry,
          trimmedBackendUrl: shared.backendUrl.trim(),
        });
        const records = toRecords(syncedNotes);

        setCards(sortCards(records.cards));
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

  async function syncOrganizationChanges(successMessage: string) {
    if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
      shared.setStatusMessage(`${successMessage} locally. Sync pending.`);
      return;
    }

    try {
      const records = toRecords(await syncOfflineNotes({
        linkedKeks: shared.linkedKeks,
        nextSession: shared.session,
        runWithSessionRetry: shared.runWithSessionRetry,
        trimmedBackendUrl: shared.backendUrl.trim(),
      }));
      setCards(sortCards(records.cards));
      shared.setStatusMessage(successMessage);
    } catch (error) {
      shared.setErrorMessage(error instanceof Error ? error.message : 'Unable to sync organization changes.');
      shared.setStatusMessage(`${successMessage} locally. Sync pending.`);
    }
  }

  async function refreshFolders() {
    if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) return;
    const remoteFolders = await shared.runWithSessionRetry(shared.session, shared.backendUrl.trim(), (activeSession) =>
      fetchFolders({ baseUrl: shared.backendUrl, token: activeSession.token }),
    );
    const decryptedFolders = await Promise.all(remoteFolders.map(async (folder) => {
      const kek = shared.linkedKeks.find((entry) => entry.kekPublicKey === folder.encryptedDek.kekPublicKey);
      if (!kek) throw new Error(`Missing the local KEK for folder ${folder.encryptedDek.kekPublicKey}.`);
      const document = parseFolderDocument(await decryptStringWithAsymmetricKek(folder, kek.cryptKey));
      return { createdAt: folder.createdAt, id: folder.id, parentFolderId: document.parentFolderId, title: document.name, updatedAt: folder.updatedAt };
    }));
    setFolders(decryptedFolders);
  }

  async function saveEncryptedFolder({ id, parentFolderId, title }: { id?: string; parentFolderId: string | null; title: string }) {
    if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) throw new Error('Connect to the backend before saving folders.');
    const principals = await shared.runWithSessionRetry(shared.session, shared.backendUrl.trim(), (activeSession) =>
      fetchLinkedPrincipals({ baseUrl: shared.backendUrl, token: activeSession.token }),
    );
    const encrypted = await encryptStringWithAsymmetricKeks(JSON.stringify({ name: title, parentFolderId, version: 1 }), principals.map((principal) => principal.latestKekPublicKey));
    const saved = await shared.runWithSessionRetry(shared.session, shared.backendUrl.trim(), (activeSession) => saveFolder({
      baseUrl: shared.backendUrl,
      folderId: id,
      payload: { encryptedDeks: encrypted.encryptedDeks.map((dek, index) => ({ ...dek, userId: principals[index]!.id })), encryptedPayload: encrypted.encryptedPayload },
      token: activeSession.token,
    }));
    return { createdAt: saved.createdAt, id: saved.id, parentFolderId, title, updatedAt: saved.updatedAt } satisfies DecryptedFolder;
  }

  async function handleCreateFolder() {
    try {
      const savedFolder = await saveEncryptedFolder({ parentFolderId: null, title: '' });
      setFolders((currentFolders) => upsertFolder(currentFolders, savedFolder));
      setFolderTitle('');
      setEditingFolderId(savedFolder.id);
      shared.setStatusMessage(`Created folder "${savedFolder.title}".`);
    } catch (error) {
      shared.setErrorMessage(error instanceof Error ? error.message : 'Unable to create the folder.');
    }
  }

  function handleStartEditFolder(folder: DecryptedFolder) {
    setFolderTitle(folder.title);
    setEditingFolderId(folder.id);
  }

  async function handleSaveFolder(folder: DecryptedFolder) {
    try {
      const savedFolder = await saveEncryptedFolder({
        id: folder.id,
        parentFolderId: folder.parentFolderId,
        title: folderTitle.trim(),
      });
      setFolders((currentFolders) => upsertFolder(currentFolders, savedFolder));
      setEditingFolderId(null);
      shared.setStatusMessage(`Updated folder "${savedFolder.title}".`);
    } catch (error) {
      shared.setErrorMessage(error instanceof Error ? error.message : 'Unable to save the folder.');
    }
  }

  async function handleMoveCard(card: DecryptedCard, folderId: string | null) {
    try {
      const savedCard = toCardRecord(await webOfflineNotesProvider.saveNote({
        content: serializeCardOrganization({ folderId, lastDoneAt: card.lastDoneAt }),
        id: card.id,
        title: card.question,
      }));
      if (!savedCard) {
        throw new Error('The local note store returned an invalid card.');
      }
      setCards((currentCards) => currentCards.map((entry) => entry.id === savedCard.id ? savedCard : entry));
      await syncOrganizationChanges(`Moved "${savedCard.question || 'Untitled card'}".`);
    } catch (error) {
      shared.setErrorMessage(error instanceof Error ? error.message : 'Unable to move the card.');
    }
  }

  async function handleMoveFolder(folder: DecryptedFolder, parentFolderId: string | null) {
    if (!canMoveFolder(folder.id, parentFolderId, folders)) {
      shared.setErrorMessage(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels and cannot contain themselves.`);
      return;
    }

    try {
      const savedFolder = await saveEncryptedFolder({ id: folder.id, parentFolderId, title: folder.title });
      setFolders((currentFolders) => currentFolders.map((entry) => entry.id === savedFolder.id ? savedFolder : entry));
      shared.setStatusMessage(`Moved folder "${savedFolder.title}".`);
    } catch (error) {
      shared.setErrorMessage(error instanceof Error ? error.message : 'Unable to move the folder.');
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
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleCreateCard} size="lg" variant="outline">New card</Button>
                <Button onClick={() => { void handleCreateFolder(); }} size="lg">
                  <FolderPlus />
                  New folder
                </Button>
              </div>
            </div>

            {folders.length > 0 ? (
              <div className="mt-5 grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Folders</p>
                {sortFolders(folders).map((folder) => (
                  <div
                    className="grid gap-2 rounded-lg border border-border/60 bg-muted/35 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
                    key={folder.id}
                    style={{ marginLeft: `${Math.min(getFolderDepth(folder.id, folders) - 1, 6) * 12}px` }}
                  >
                    {folder.id === editingFolderId ? (
                      <input
                        autoFocus
                        className="min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm"
                        onChange={(event) => setFolderTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void handleSaveFolder(folder);
                          if (event.key === 'Escape') setEditingFolderId(null);
                        }}
                        placeholder="Folder name"
                        value={folderTitle}
                      />
                    ) : (
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{folder.title || 'Untitled folder'}</span>
                    )}
                    <select
                      aria-label={`Move folder ${folder.title}`}
                      className="rounded-md border border-border bg-background px-2 py-2 text-sm"
                      onChange={(event) => { void handleMoveFolder(folder, event.target.value || null); }}
                      value={folder.parentFolderId ?? ''}
                    >
                      <option value="">Top level</option>
                      {folders.filter((target) => target.id !== folder.id && canMoveFolder(folder.id, target.id, folders)).map((target) => (
                        <option key={target.id} value={target.id}>{formatFolderLabel(target, folders)}</option>
                      ))}
                    </select>
                    <div className="flex gap-1 sm:col-start-2">
                      {folder.id === editingFolderId ? (
                        <>
                          <Button aria-label="Save folder" onClick={() => { void handleSaveFolder(folder); }} size="icon" title="Save folder"><Check /></Button>
                          <Button aria-label="Cancel editing folder" onClick={() => setEditingFolderId(null)} size="icon" title="Cancel editing folder" variant="outline"><X /></Button>
                        </>
                      ) : (
                        <Button aria-label="Edit folder" onClick={() => handleStartEditFolder(folder)} size="icon" title="Edit folder" variant="outline"><Pencil /></Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

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
                        <select
                          aria-label={`Move card ${card.question || 'Untitled card'}`}
                          className="h-9 max-w-32 rounded-md border border-border bg-background px-2 text-xs"
                          onChange={(event) => { void handleMoveCard(card, event.target.value || null); }}
                          value={card.folderId ?? ''}
                        >
                          <option value="">Top level</option>
                          {sortFolders(folders).map((folder) => (
                            <option key={folder.id} value={folder.id}>{formatFolderLabel(folder, folders)}</option>
                          ))}
                        </select>
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
}): DecryptedCard | null {
  const organization = parseNoteOrganization(note.content);

  if (organization.kind !== 'card') {
    return null;
  }

  return {
    createdAt: note.createdAt,
    folderId: organization.folderId,
    id: note.id,
    lastDoneAt: organization.lastDoneAt,
    question: note.title,
    updatedAt: note.updatedAt,
  };
}

function toFolderRecord(note: {
  content: string;
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
}): DecryptedFolder | null {
  const organization = parseNoteOrganization(note.content);

  if (organization.kind !== 'folder') {
    return null;
  }

  return {
    createdAt: note.createdAt,
    id: note.id,
    parentFolderId: organization.parentFolderId,
    title: note.title,
    updatedAt: note.updatedAt,
  };
}

function toRecords(notes: Parameters<typeof toCardRecord>[0][]) {
  const cards: DecryptedCard[] = [];
  const folders: DecryptedFolder[] = [];

  for (const note of notes) {
    const card = toCardRecord(note);
    if (card) {
      cards.push(card);
      continue;
    }
    const folder = toFolderRecord(note);
    if (folder) {
      folders.push(folder);
    }
  }

  return { cards, folders };
}

function sortCards(cards: DecryptedCard[]) {
  return [...cards].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortFolders(folders: DecryptedFolder[]) {
  return [...folders].sort((left, right) => {
    const depthDifference = getFolderDepth(left.id, folders) - getFolderDepth(right.id, folders);
    return depthDifference || left.title.localeCompare(right.title);
  });
}

function upsertFolder(folders: DecryptedFolder[], savedFolder: DecryptedFolder) {
  const existingIndex = folders.findIndex((folder) => folder.id === savedFolder.id);

  if (existingIndex === -1) {
    return [...folders, savedFolder];
  }

  return folders.map((folder) => folder.id === savedFolder.id ? savedFolder : folder);
}

function getFolderDepth(folderId: string, folders: DecryptedFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const visited = new Set<string>();
  let depth = 1;
  let parentId = byId.get(folderId)?.parentFolderId ?? null;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentFolderId ?? null;
  }

  return depth;
}

function canMoveFolder(folderId: string, parentFolderId: string | null, folders: DecryptedFolder[]) {
  if (!parentFolderId) {
    return true;
  }
  if (folderId === parentFolderId || isFolderDescendant(parentFolderId, folderId, folders)) {
    return false;
  }

  const subtreeHeight = Math.max(
    ...folders
      .filter((folder) => folder.id === folderId || isFolderDescendant(folder.id, folderId, folders))
      .map((folder) => getFolderDepth(folder.id, folders) - getFolderDepth(folderId, folders) + 1),
  );

  return getFolderDepth(parentFolderId, folders) + subtreeHeight <= MAX_FOLDER_DEPTH;
}

function isFolderDescendant(folderId: string, ancestorId: string, folders: DecryptedFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const visited = new Set<string>();
  let parentId = byId.get(folderId)?.parentFolderId ?? null;

  while (parentId && !visited.has(parentId)) {
    if (parentId === ancestorId) {
      return true;
    }
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentFolderId ?? null;
  }

  return false;
}

function formatFolderLabel(folder: DecryptedFolder, folders: DecryptedFolder[]) {
  return `${'  '.repeat(Math.min(getFolderDepth(folder.id, folders) - 1, 6))}${folder.title}`;
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
