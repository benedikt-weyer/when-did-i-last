'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { subscribeToNoteEvents } from '@repo/realtime';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  MAX_FOLDER_DEPTH,
  parseNoteOrganization,
  serializeCardOrganization,
} from '@repo/offline-provider';
import { decryptStringWithAsymmetricKek, encryptStringWithAsymmetricKeks } from '@repo/e2ee-auth/web';
import { ChartNoAxesColumnIncreasing, Check, Folder, FolderPlus, Pencil, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fetchLinkedPrincipals } from '@/lib/auth-api';
import { deleteFolder, fetchFolders, saveFolder } from '@/lib/folder-api';

import {
  PageShell,
  SignedOutForm,
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
  doneAtHistory: string[];
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

type HistoryCutoff = '1h' | '1y' | '24h' | '30d' | '7d' | 'all';
type HistoryResolution = 'day' | 'hour' | 'minute' | 'month' | 'week' | 'year';

const historyCutoffLabels: Record<HistoryCutoff, string> = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '1y': 'Last year',
  all: 'All history',
};

const historyResolutionLabels: Record<HistoryResolution, string> = {
  year: 'Years',
  month: 'Months',
  week: 'Weeks',
  day: 'Days',
  hour: 'Hours',
  minute: 'Minutes',
};

export function CardsPageClient() {
  const [cardQuestion, setCardQuestion] = useState('');
  const [cards, setCards] = useState<DecryptedCard[]>([]);
  const [folders, setFolders] = useState<DecryptedFolder[]>([]);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderTitle, setFolderTitle] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ id: string; type: 'card' | 'folder' } | null>(null);
  const [historyCardId, setHistoryCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const selectedCardIdRef = useRef<string | null>(null);

  const applySelectedCard = useCallback((card: DecryptedCard | null) => {
    const nextSelectedCardId = card?.id ?? null;

    selectedCardIdRef.current = nextSelectedCardId;
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
        content: serializeCardOrganization({ doneAtHistory: [], folderId: currentFolderId, lastDoneAt: null }),
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
          doneAtHistory: selectedCard.doneAtHistory,
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
      const now = new Date().toISOString();
      const savedCard = toCardRecord(await webOfflineNotesProvider.saveNote({
        content: serializeCardOrganization({
          doneAtHistory: [...card.doneAtHistory, now],
          folderId: card.folderId,
          lastDoneAt: now,
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
      if (currentFolderId && getFolderDepth(currentFolderId, folders) >= MAX_FOLDER_DEPTH) {
        throw new Error(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels.`);
      }
      const savedFolder = await saveEncryptedFolder({ parentFolderId: currentFolderId, title: '' });
      setFolders((currentFolders) => upsertFolder(currentFolders, savedFolder));
      setFolderTitle('');
      setEditingFolderId(savedFolder.id);
      shared.setStatusMessage(`Created folder "${savedFolder.title}".`);
    } catch (error) {
      shared.setErrorMessage(error instanceof Error ? error.message : 'Unable to create the folder.');
    }
  }

  const breadcrumbs = getFolderBreadcrumbs(currentFolderId, folders);
  const visibleFolders = sortFolders(folders.filter((folder) => folder.parentFolderId === currentFolderId));
  const visibleCards = cards.filter((card) => card.folderId === currentFolderId);

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
        content: serializeCardOrganization({ doneAtHistory: card.doneAtHistory, folderId, lastDoneAt: card.lastDoneAt }),
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

  async function handleDeleteFolder(folder: DecryptedFolder) {
    if (!shared.session || shared.linkedKeks.length === 0 || !shared.backendUrl.trim()) {
      shared.setErrorMessage('Connect to the backend before deleting folders.');
      return;
    }

    const folderIds = getFolderDescendantIds(folder.id, folders);
    const cardsToDelete = cards.filter((card) => card.folderId && folderIds.has(card.folderId));

    try {
      for (const card of cardsToDelete) {
        await webOfflineNotesProvider.deleteNote(card.id);
      }

      const records = toRecords(await syncOfflineNotes({
        linkedKeks: shared.linkedKeks,
        nextSession: shared.session,
        runWithSessionRetry: shared.runWithSessionRetry,
        trimmedBackendUrl: shared.backendUrl.trim(),
      }));
      setCards(sortCards(records.cards));

      const foldersToDelete = folders
        .filter((entry) => folderIds.has(entry.id))
        .sort((left, right) => getFolderDepth(right.id, folders) - getFolderDepth(left.id, folders));
      for (const entry of foldersToDelete) {
        await shared.runWithSessionRetry(shared.session, shared.backendUrl.trim(), (activeSession) =>
          deleteFolder({ baseUrl: shared.backendUrl, folderId: entry.id, token: activeSession.token }),
        );
      }

      setFolders((currentFolders) => currentFolders.filter((entry) => !folderIds.has(entry.id)));
      if (currentFolderId && folderIds.has(currentFolderId)) setCurrentFolderId(folder.parentFolderId);
      setEditingFolderId(null);
      shared.setStatusMessage(`Removed folder "${folder.title || 'Untitled folder'}" and its contents.`);
    } catch (error) {
      shared.setErrorMessage(error instanceof Error ? error.message : 'Unable to remove the folder and its contents.');
    }
  }

  async function handleChooseMoveDestination(parentFolderId: string | null) {
    if (!moveTarget) return;

    const target = moveTarget;
    setMoveTarget(null);

    if (target.type === 'card') {
      const card = cards.find((entry) => entry.id === target.id);
      if (card) await handleMoveCard(card, parentFolderId);
      return;
    }

    const folder = folders.find((entry) => entry.id === target.id);
    if (folder) await handleMoveFolder(folder, parentFolderId);
  }

  return (
    <PageShell title="When did I last...">
      {shared.session ? (
        <div className="grid w-full gap-4">
          <div className={panelClassName} id="cards">
            <div className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Cards ({visibleCards.length})
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleCreateCard} size="lg" variant="outline">New card</Button>
                <Button onClick={() => { void handleCreateFolder(); }} size="lg">
                  <FolderPlus />
                  New folder
                </Button>
              </div>
            </div>

            <nav aria-label="Folder path" className="mt-4 flex flex-wrap items-center gap-1 text-sm">
              {currentFolderId ? (
                <Button aria-label="Back to parent folder" onClick={() => setCurrentFolderId(breadcrumbs.at(-2)?.id ?? null)} size="icon" title="Back">
                  <span aria-hidden="true">&larr;</span>
                </Button>
              ) : null}
              <button className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setCurrentFolderId(null)} type="button">Cards</button>
              {breadcrumbs.map((folder) => (
                <span className="flex items-center gap-1" key={folder.id}>
                  <span className="text-muted-foreground">/</span>
                  <button className="rounded px-2 py-1 hover:bg-muted" onClick={() => setCurrentFolderId(folder.id)} type="button">{folder.title || 'Untitled folder'}</button>
                </span>
              ))}
            </nav>

            {visibleFolders.length > 0 ? (
              <div className="mt-5 grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Folders</p>
                {visibleFolders.map((folder) => (
                  <div
                    className="grid cursor-pointer gap-2 rounded-lg border border-border/60 bg-muted/35 px-3 py-3 hover:border-primary/50 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center"
                    key={folder.id}
                    onClick={() => {
                      if (folder.id !== editingFolderId) setCurrentFolderId(folder.id);
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      {folder.id === editingFolderId ? (
                        <input
                          autoFocus
                          className="min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm"
                          onChange={(event) => setFolderTitle(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
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
                    </div>
                    <div className="flex justify-end gap-1 sm:col-start-2">
                      <Button aria-label={`Move folder ${folder.title || 'Untitled folder'}`} onClick={(event) => { event.stopPropagation(); setMoveTarget({ id: folder.id, type: 'folder' }); }} size="sm" title="Move folder" variant="outline">Move</Button>
                      {folder.id === editingFolderId ? (
                        <>
                          <Button aria-label="Save folder" onClick={(event) => { event.stopPropagation(); void handleSaveFolder(folder); }} size="icon" title="Save folder"><Check /></Button>
                          <Button aria-label="Cancel editing folder" onClick={(event) => { event.stopPropagation(); setEditingFolderId(null); }} size="icon" title="Cancel editing folder" variant="outline"><X /></Button>
                        </>
                      ) : (
                        <Button aria-label="Edit folder" onClick={(event) => { event.stopPropagation(); handleStartEditFolder(folder); }} size="icon" title="Edit folder" variant="outline"><Pencil /></Button>
                      )}
                      <Button aria-label={`Remove folder ${folder.title || 'Untitled folder'}`} onClick={(event) => { event.stopPropagation(); void handleDeleteFolder(folder); }} size="icon" title="Remove folder" variant="ghost"><Trash2 /></Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-5 grid gap-3">
              {visibleCards.length === 0 ? (
                <p className="rounded-[1.4rem] border border-dashed border-border/70 bg-background/75 px-4 py-5 text-sm text-foreground/65">
                  No encrypted cards in this folder yet.
                </p>
              ) : (
                visibleCards.map((card) => {
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
                        <Button aria-label={`Move card ${card.question || 'Untitled card'}`} onClick={() => setMoveTarget({ id: card.id, type: 'card' })} size="sm" title="Move card" variant="outline">Move</Button>
                        <Button aria-label={`Show history for ${card.question || 'Untitled card'}`} onClick={() => setHistoryCardId(card.id)} size="sm" title="Show history" variant="outline"><ChartNoAxesColumnIncreasing />History</Button>
                        <Button aria-label="Remove card" onClick={() => { void handleDeleteCard(card.id); }} size="icon" title="Remove card" variant="ghost">
                          <Trash2 />
                        </Button>
                        <Button
                          aria-label="Mark card as done now"
                          onClick={() => { void handleMarkNow(card.id); }}
                          size="sm"
                          title="Mark as done now"
                        >
                          Now
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

          {moveTarget ? (
            <div className="fixed inset-0 z-50 flex items-end bg-black/35 p-4 sm:items-center sm:justify-center" onClick={() => setMoveTarget(null)}>
              <div aria-modal="true" className="max-h-[75vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()} role="dialog">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-foreground">Move to folder</h2>
                  <Button aria-label="Close move dialog" onClick={() => setMoveTarget(null)} size="icon" title="Close" variant="ghost"><X /></Button>
                </div>
                <div className="mt-3 grid gap-1">
                  <Button className="justify-start" onClick={() => { void handleChooseMoveDestination(null); }} variant="ghost">Top level</Button>
                  {sortFolders(folders).filter((folder) => moveTarget.type !== 'folder' || canMoveFolder(moveTarget.id, folder.id, folders)).map((folder) => (
                    <Button className="justify-start" key={folder.id} onClick={() => { void handleChooseMoveDestination(folder.id); }} variant="ghost">
                      <Folder className="size-4" />
                      {formatFolderLabel(folder, folders)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {historyCardId ? (
            <HistoryDialog card={cards.find((card) => card.id === historyCardId) ?? null} onClose={() => setHistoryCardId(null)} />
          ) : null}

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

function HistoryDialog({ card, onClose }: { card: DecryptedCard | null; onClose: () => void }) {
  const history = card ? [...card.doneAtHistory].sort((left, right) => left.localeCompare(right)) : [];
  const initialView = chooseHistoryView(history);
  const [cutoff, setCutoff] = useState<HistoryCutoff>(initialView.cutoff);
  const [resolution, setResolution] = useState<HistoryResolution>(initialView.resolution);
  const series = buildHistorySeries(history, cutoff, resolution);

  if (!card) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/35 p-4 sm:items-center sm:justify-center" onClick={onClose}>
      <div aria-modal="true" className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-xl" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Completion history</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{appendQuestionMark(card.question)}</h2>
          </div>
          <Button aria-label="Close history" onClick={onClose} size="icon" title="Close" variant="ghost"><X /></Button>
        </div>

        {history.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">No completion history yet.</p>
        ) : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium text-foreground">
                Resolution
                <select className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" onChange={(event) => setResolution(event.target.value as HistoryResolution)} value={resolution}>
                  {Object.entries(historyResolutionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium text-foreground">
                Cutoff
                <select className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal" onChange={(event) => setCutoff(event.target.value as HistoryCutoff)} value={cutoff}>
                  {Object.entries(historyCutoffLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-6 h-56">
              {series.length === 0 ? (
                <p className="pt-16 text-center text-sm text-muted-foreground">No completions in this range.</p>
              ) : (
                <ResponsiveContainer height="100%" width="100%">
                  <BarChart data={series} margin={{ bottom: 8, left: -18, right: 8, top: 8 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={44} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px' }}
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      formatter={(value) => [`${value} completion${Number(value) === 1 ? '' : 's'}`, 'Count']}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-5 max-h-36 overflow-y-auto border-t border-border/60 pt-3">
              {filterHistoryByCutoff(history, cutoff).slice().reverse().map((timestamp) => (
                <p className="py-1 text-sm text-foreground/80" key={timestamp}>{formatTimestamp(timestamp)}</p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function chooseHistoryView(history: string[]) {
  const span = history.length > 1 ? Date.now() - Date.parse(history[0]!) : 0;

  if (span > 365 * 24 * 60 * 60 * 1000) return { cutoff: 'all' as const, resolution: 'month' as const };
  if (span > 30 * 24 * 60 * 60 * 1000) return { cutoff: '1y' as const, resolution: 'week' as const };
  if (span > 7 * 24 * 60 * 60 * 1000) return { cutoff: '30d' as const, resolution: 'day' as const };
  if (span > 24 * 60 * 60 * 1000) return { cutoff: '7d' as const, resolution: 'hour' as const };
  if (span > 60 * 60 * 1000) return { cutoff: '24h' as const, resolution: 'hour' as const };
  return { cutoff: '1h' as const, resolution: 'minute' as const };
}

function buildHistorySeries(history: string[], cutoff: HistoryCutoff, resolution: HistoryResolution) {
  if (history.length === 0) {
    return [];
  }

  const counts = new Map<string, number>();

  for (const timestamp of filterHistoryByCutoff(history, cutoff)) {
    const date = new Date(timestamp);
    const key = getHistoryBucketKey(date, resolution);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const start = getHistorySeriesStart(history, cutoff, resolution);
  const end = getHistoryBucketStart(new Date(), resolution);
  const series: Array<{ count: number; key: string; label: string }> = [];
  const cursor = new Date(start);

  // A finer manual resolution can produce many buckets; keep rendering bounded.
  while (cursor <= end && series.length < 2_000) {
    const key = getHistoryBucketKey(cursor, resolution);
    series.push({ count: counts.get(key) ?? 0, key, label: formatHistoryBucket(cursor, resolution) });
    advanceHistoryBucket(cursor, resolution);
  }

  return series;
}

function getHistorySeriesStart(history: string[], cutoff: HistoryCutoff, resolution: HistoryResolution) {
  const cutoffMilliseconds: Record<Exclude<HistoryCutoff, 'all'>, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000,
  };
  const start = cutoff === 'all' ? new Date(history[0]!) : new Date(Date.now() - cutoffMilliseconds[cutoff]);
  return getHistoryBucketStart(start, resolution);
}

function getHistoryBucketStart(date: Date, resolution: HistoryResolution) {
  const start = new Date(date);
  if (resolution === 'year') start.setUTCMonth(0, 1);
  if (resolution === 'month') start.setUTCDate(1);
  if (resolution === 'week') {
    const dayOfWeek = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - dayOfWeek + 1);
  }
  if (resolution === 'year' || resolution === 'month' || resolution === 'week' || resolution === 'day') start.setUTCHours(0, 0, 0, 0);
  if (resolution === 'hour') start.setUTCMinutes(0, 0, 0);
  if (resolution === 'minute') start.setUTCSeconds(0, 0);
  return start;
}

function advanceHistoryBucket(date: Date, resolution: HistoryResolution) {
  if (resolution === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  if (resolution === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  if (resolution === 'week') date.setUTCDate(date.getUTCDate() + 7);
  if (resolution === 'day') date.setUTCDate(date.getUTCDate() + 1);
  if (resolution === 'hour') date.setUTCHours(date.getUTCHours() + 1);
  if (resolution === 'minute') date.setUTCMinutes(date.getUTCMinutes() + 1);
}

function filterHistoryByCutoff(history: string[], cutoff: HistoryCutoff) {
  const cutoffMilliseconds: Record<Exclude<HistoryCutoff, 'all'>, number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000,
  };
  const threshold = cutoff === 'all' ? null : Date.now() - cutoffMilliseconds[cutoff];
  return threshold === null ? history : history.filter((timestamp) => Date.parse(timestamp) >= threshold);
}

function getHistoryBucketKey(date: Date, resolution: HistoryResolution) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  if (resolution === 'year') return `${year}`;
  if (resolution === 'month') return `${year}-${month}`;
  if (resolution === 'week') {
    const weekStart = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = weekStart.getUTCDay() || 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek + 1);
    return weekStart.toISOString().slice(0, 10);
  }
  if (resolution === 'day') return `${year}-${month}-${day}`;
  if (resolution === 'hour') return `${year}-${month}-${day}T${hour}`;
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatHistoryBucket(date: Date, resolution: HistoryResolution) {
  if (resolution === 'year') return `${date.getUTCFullYear()}`;
  if (resolution === 'month') return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  if (resolution === 'week') return `Week of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  if (resolution === 'day') return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (resolution === 'hour') return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
  return date.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
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
    doneAtHistory: organization.doneAtHistory,
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

function getFolderBreadcrumbs(folderId: string | null, folders: DecryptedFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const breadcrumbs: DecryptedFolder[] = [];
  const visited = new Set<string>();
  let currentId = folderId;

  while (currentId && !visited.has(currentId)) {
    const folder = byId.get(currentId);
    if (!folder) break;
    visited.add(currentId);
    breadcrumbs.unshift(folder);
    currentId = folder.parentFolderId;
  }

  return breadcrumbs;
}

function getFolderDescendantIds(folderId: string, folders: DecryptedFolder[]) {
  const folderIds = new Set([folderId]);
  let hasNewDescendants = true;

  while (hasNewDescendants) {
    hasNewDescendants = false;
    for (const folder of folders) {
      if (folder.parentFolderId && folderIds.has(folder.parentFolderId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        hasNewDescendants = true;
      }
    }
  }

  return folderIds;
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
