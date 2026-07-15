import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { subscribeToNoteEvents } from '@repo/realtime';
import { ArrowLeft, ChartNoAxesColumnIncreasing, Check, Folder, FolderOpen, Pencil, Trash2, UserRound, X } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import {
  MAX_FOLDER_DEPTH,
  parseNoteOrganization,
  serializeCardOrganization,
} from '@repo/offline-provider';

import {
  createMobileOfflineNotesSyncAdapter,
  getMobileOfflineNotesProvider,
} from '../features/e2ee/offline-notes';
import { deleteFolder, fetchFolders, saveFolder } from '../features/e2ee/folder-api';
import { getNativeAuthModule } from '../features/e2ee/native-runtime';
import { useAuth } from '../features/auth/auth-context';
import type { AuthApiResponse } from '../features/auth/auth-api';
import { useAppTheme } from '../features/theme/theme-context';

type DecryptedCard = {
  createdAt: string;
  doneAtHistory: string[];
  id: string;
  folderId: string | null;
  lastDoneAt: string | null;
  question: string;
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

type HistoryCutoff = '1h' | '1y' | '24h' | '30d' | '7d' | 'all';
type HistoryResolution = 'day' | 'hour' | 'minute' | 'month' | 'week' | 'year';

const historyCutoffs: Array<{ label: string; value: HistoryCutoff }> = [
  { label: '1h', value: '1h' }, { label: '24h', value: '24h' }, { label: '7d', value: '7d' },
  { label: '30d', value: '30d' }, { label: '1y', value: '1y' }, { label: 'All', value: 'all' },
];

const historyResolutions: Array<{ label: string; value: HistoryResolution }> = [
  { label: 'Y', value: 'year' }, { label: 'M', value: 'month' }, { label: 'W', value: 'week' },
  { label: 'D', value: 'day' }, { label: 'H', value: 'hour' }, { label: 'Min', value: 'minute' },
];

const homeColors = {
  dark: { background: '#242217', border: '#514c39', danger: '#f2a7a0', dangerSurface: '#4a2524', muted: '#d8d3b8', mutedSurface: '#363428', primary: '#d6cf98', primaryText: '#242217', surface: '#2f2d24', text: '#f3efdc' },
  light: { background: '#F5EFB9', border: '#e1d99d', danger: '#c2410c', dangerSurface: '#fef2f2', muted: '#52525b', mutedSurface: '#e9edf1', primary: '#47474d', primaryText: '#ffffff', surface: '#ffffff', text: '#262626' },
};

// Expo resolves bundled image assets through require at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../assets/when-did-i-last-logo-bg-s.png');

export function HomeScreen() {
  const { themeMode } = useAppTheme();
  const router = useRouter();
  const {
    activeKekId,
    backendUrl,
    linkedKeks,
    refreshKekMigrationStatus,
    runWithFreshSession,
    session,
  } = useAuth();
  const colors = homeColors[themeMode];
  const [cardQuestion, setCardQuestion] = useState('');
  const [cards, setCards] = useState<DecryptedCard[]>([]);
  const [folders, setFolders] = useState<DecryptedFolder[]>([]);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderTitle, setFolderTitle] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [historyCardId, setHistoryCardId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ itemId: string; type: 'card' | 'folder' } | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const selectedCardIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const [, setStatusMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const applyOfflineSnapshot = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }

    const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();

    const records = toRecords(mobileOfflineNotesProvider.getSnapshot().notes);
    const nextCards = sortCards(records.cards);

    setCards(nextCards);

    const nextSelectedCard =
      nextCards.find((card) => card.id === selectedCardIdRef.current) ??
      nextCards[0] ??
      null;

    applySelectedCard(nextSelectedCard);
  }, []);

  const syncOfflineNotes = useCallback(async ({
    activeLinkedKekId,
    linkedKeks,
    nextSession,
  }: {
    activeLinkedKekId: string;
    linkedKeks: { cryptKey: Uint8Array; kekPublicKey: string }[];
    nextSession: AuthApiResponse;
  }) => {
    const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
    const adapter = createMobileOfflineNotesSyncAdapter({
      activeKekId: activeLinkedKekId,
      backendUrl,
      linkedKeks,
      runWithFreshSession,
      session: nextSession,
    });

    await mobileOfflineNotesProvider.sync(adapter);
    await refreshKekMigrationStatus();
  }, [backendUrl, refreshKekMigrationStatus, runWithFreshSession]);

  useEffect(() => {
    let unsubscribe = () => {};

    void getMobileOfflineNotesProvider().then((mobileOfflineNotesProvider) => {
      unsubscribe = mobileOfflineNotesProvider.subscribe(() => {
        void applyOfflineSnapshot();
      });

      return mobileOfflineNotesProvider.initialize().then(() => {
        return applyOfflineSnapshot();
      });
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

    void syncOfflineNotes({
      activeLinkedKekId: activeKekId,
      linkedKeks,
      nextSession: session,
    }).then(async () => {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const cardCount = mobileOfflineNotesProvider.getSnapshot().notes.length;

      setStatusMessage(buildInitialCardSyncMessage(cardCount));
    }).catch(async (error) => {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const cardCount = mobileOfflineNotesProvider.getSnapshot().notes.length;

      setStatusMessage(buildOfflineSyncFailureMessage(cardCount, error));
    });
  }, [activeKekId, linkedKeks, session, syncOfflineNotes]);

  useEffect(() => {
    if (!session || linkedKeks.length === 0 || !activeKekId || !backendUrl.trim()) return;
    void refreshFolders().catch((error) => setStatusMessage(error instanceof Error ? error.message : 'Unable to load encrypted folders.'));
  // Folder loading is intentionally driven by authentication and key changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKekId, backendUrl, linkedKeks, session]);

  useEffect(() => {
    if (!session || linkedKeks.length === 0 || !activeKekId) {
      return;
    }

    try {
      const subscription = subscribeToNoteEvents({
        accessToken: session.token,
        baseUrl: backendUrl,
        onError: (error) => {
          setStatusMessage(error.message);
        },
        onEvent: () => {
          void syncOfflineNotes({
            activeLinkedKekId: activeKekId,
            linkedKeks,
            nextSession: session,
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
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to connect card realtime updates.',
      );
    }
  }, [activeKekId, backendUrl, linkedKeks, session, syncOfflineNotes]);

  useEffect(() => {
    if (!session || linkedKeks.length === 0 || !activeKekId) {
      return;
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        return;
      }

      void syncOfflineNotes({
        activeLinkedKekId: activeKekId,
        linkedKeks,
        nextSession: session,
      }).catch(() => {
        // Background reconnect attempts are best-effort.
      });
    });

    return () => {
      subscription.remove();
    };
  }, [activeKekId, linkedKeks, session, syncOfflineNotes]);

  function applySelectedCard(card: DecryptedCard | null) {
    selectedCardIdRef.current = card?.id ?? null;
    setCardQuestion(card?.question ?? '');
  }

  async function handleCreateCard() {
    try {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const newCard = toCardRecord(await mobileOfflineNotesProvider.saveNote({
        content: serializeCardOrganization({ doneAtHistory: [], folderId: currentFolderId, lastDoneAt: null }),
        title: '',
      }));
      if (!newCard) {
        throw new Error('The local note store returned an invalid card.');
      }

      setCards((currentCards) => sortCards([...currentCards, newCard]));
      applySelectedCard(newCard);
      setEditingCardId(newCard.id);

      if (!session || linkedKeks.length === 0 || !activeKekId) {
        setStatusMessage('Created a new encrypted card locally. Sync pending.');
        return;
      }

      try {
        await syncOfflineNotes({
          activeLinkedKekId: activeKekId,
          linkedKeks,
          nextSession: session,
        });
        setStatusMessage('Created a new encrypted card.');
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? `Created a new encrypted card locally. ${error.message}`
            : 'Created a new encrypted card locally. Sync pending.',
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to create the encrypted card.',
      );
    }
  }

  function handleStartEdit(card: DecryptedCard) {
    applySelectedCard(card);
    setEditingCardId(card.id);
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

    try {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const savedCard = toCardRecord(await mobileOfflineNotesProvider.saveNote({
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

      if (!session || linkedKeks.length === 0 || !activeKekId) {
        setStatusMessage(
          `${actionLabel} "${savedCard.question || 'Untitled card'}" locally. Sync pending.`,
        );
        return;
      }

      try {
        await syncOfflineNotes({
          activeLinkedKekId: activeKekId,
          linkedKeks,
          nextSession: session,
        });
        setStatusMessage(`${actionLabel} "${savedCard.question || 'Untitled card'}".`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? `${actionLabel} "${savedCard.question || 'Untitled card'}" locally. ${error.message}`
            : `${actionLabel} "${savedCard.question || 'Untitled card'}" locally. Sync pending.`,
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to save the encrypted card.',
      );
    }
  }

  async function handleDeleteCard(cardId: string) {
    try {
      const deletedCard = cards.find((card) => card.id === cardId) ?? null;
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();

      await mobileOfflineNotesProvider.deleteNote(cardId);
      setCards((currentCards) => currentCards.filter((card) => card.id !== cardId));
      if (selectedCardIdRef.current === cardId) {
        applySelectedCard(null);
      }
      if (editingCardId === cardId) {
        setEditingCardId(null);
      }

      if (!session || linkedKeks.length === 0 || !activeKekId) {
        setStatusMessage(`Deleted "${deletedCard?.question || 'Untitled card'}" locally. Sync pending.`);
        return;
      }

      try {
        await syncOfflineNotes({
          activeLinkedKekId: activeKekId,
          linkedKeks,
          nextSession: session,
        });
        setStatusMessage(`Deleted "${deletedCard?.question || 'Untitled card'}".`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? `Deleted "${deletedCard?.question || 'Untitled card'}" locally. ${error.message}`
            : `Deleted "${deletedCard?.question || 'Untitled card'}" locally. Sync pending.`,
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to delete the encrypted card.',
      );
    }
  }

  async function handleMarkNow(cardId: string) {
    const card = cards.find((entry) => entry.id === cardId) ?? null;

    if (!card) {
      return;
    }

    try {
      const now = new Date().toISOString();
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const savedCard = toCardRecord(await mobileOfflineNotesProvider.saveNote({
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

      if (!session || linkedKeks.length === 0 || !activeKekId) {
        setStatusMessage(`Updated "${savedCard.question}" locally. Sync pending.`);
        return;
      }

      try {
        await syncOfflineNotes({
          activeLinkedKekId: activeKekId,
          linkedKeks,
          nextSession: session,
        });
        setStatusMessage(`Updated "${savedCard.question}" to now.`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? `Updated "${savedCard.question}" locally. ${error.message}`
            : `Updated "${savedCard.question}" locally. Sync pending.`,
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to update the card timestamp.',
      );
    }
  }

  async function syncOrganizationChanges(successMessage: string) {
    if (!session || linkedKeks.length === 0 || !activeKekId) {
      setStatusMessage(`${successMessage} locally. Sync pending.`);
      return;
    }

    try {
      await syncOfflineNotes({
        activeLinkedKekId: activeKekId,
        linkedKeks,
        nextSession: session,
      });
      setStatusMessage(successMessage);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? `${successMessage} locally. ${error.message}` : `${successMessage} locally. Sync pending.`,
      );
    }
  }

  async function refreshFolders() {
    if (!session) return;
    const remoteFolders = await runWithFreshSession((activeSession) => fetchFolders({ baseUrl: backendUrl, token: activeSession.token }));
    const { decryptStringWithAsymmetricKek } = await getNativeAuthModule();
    const decryptedFolders = await Promise.all(remoteFolders.map(async (folder) => {
      const kek = linkedKeks.find((entry) => entry.kekPublicKey === folder.encryptedDek.kekPublicKey);
      if (!kek) throw new Error(`Missing the local KEK for folder ${folder.encryptedDek.kekPublicKey}.`);
      const document = parseFolderDocument(await decryptStringWithAsymmetricKek(folder, kek.cryptKey));
      return { createdAt: folder.createdAt, id: folder.id, parentFolderId: document.parentFolderId, title: document.name, updatedAt: folder.updatedAt };
    }));
    setFolders(decryptedFolders);
  }

  async function saveEncryptedFolder({ id, parentFolderId, title }: { id?: string; parentFolderId: string | null; title: string }) {
    if (!session || !activeKekId) throw new Error('Connect to the backend before saving folders.');
    const { encryptStringWithAsymmetricKek } = await getNativeAuthModule();
    const kek = linkedKeks.find((entry) => entry.kekPublicKey === activeKekId);
    if (!kek) throw new Error('Missing the active local KEK for the folder.');
    const encrypted = await encryptStringWithAsymmetricKek(JSON.stringify({ name: title, parentFolderId, version: 1 }), kek.kekPublicKey);
    const saved = await runWithFreshSession((activeSession) => saveFolder({
      baseUrl: backendUrl, folderId: id,
      payload: { encryptedDeks: [{ ...encrypted.encryptedDek, userId: activeSession.user.id }], encryptedPayload: encrypted.encryptedPayload },
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
      setStatusMessage(`Created folder "${savedFolder.title}".`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to create the folder.');
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
      setStatusMessage(`Updated folder "${savedFolder.title}".`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to save the folder.');
    }
  }

  async function handleMoveCard(card: DecryptedCard, folderId: string | null) {
    try {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const savedCard = toCardRecord(await mobileOfflineNotesProvider.saveNote({
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
      setStatusMessage(error instanceof Error ? error.message : 'Unable to move the card.');
    }
  }

  async function handleMoveFolder(folder: DecryptedFolder, parentFolderId: string | null) {
    if (!canMoveFolder(folder.id, parentFolderId, folders)) {
      setStatusMessage(`Folders can be nested at most ${MAX_FOLDER_DEPTH} levels and cannot contain themselves.`);
      return;
    }

    try {
      const savedFolder = await saveEncryptedFolder({ id: folder.id, parentFolderId, title: folder.title });
      setFolders((currentFolders) => currentFolders.map((entry) => entry.id === savedFolder.id ? savedFolder : entry));
      setStatusMessage(`Moved folder "${savedFolder.title}".`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to move the folder.');
    }
  }

  async function handleDeleteFolder(folder: DecryptedFolder) {
    if (!session || linkedKeks.length === 0 || !activeKekId || !backendUrl.trim()) {
      setStatusMessage('Connect to the backend before deleting folders.');
      return;
    }

    const folderIds = getFolderDescendantIds(folder.id, folders);
    const cardsToDelete = cards.filter((card) => card.folderId && folderIds.has(card.folderId));

    try {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      for (const card of cardsToDelete) {
        await mobileOfflineNotesProvider.deleteNote(card.id);
      }
      await syncOfflineNotes({ activeLinkedKekId: activeKekId, linkedKeks, nextSession: session });

      const foldersToDelete = folders
        .filter((entry) => folderIds.has(entry.id))
        .sort((left, right) => getFolderDepth(right.id, folders) - getFolderDepth(left.id, folders));
      for (const entry of foldersToDelete) {
        await runWithFreshSession((activeSession) =>
          deleteFolder({ baseUrl: backendUrl, folderId: entry.id, token: activeSession.token }),
        );
      }

      setFolders((currentFolders) => currentFolders.filter((entry) => !folderIds.has(entry.id)));
      if (currentFolderId && folderIds.has(currentFolderId)) setCurrentFolderId(folder.parentFolderId);
      setEditingFolderId(null);
      setStatusMessage(`Removed folder "${folder.title || 'Untitled folder'}" and its contents.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to remove the folder and its contents.');
    }
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: 32,
          paddingHorizontal: 16,
          paddingTop: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full items-start pb-6 pt-4">
          <View className="self-stretch flex-row items-center">
            <View className="flex-row items-center gap-3">
              <View className="overflow-hidden rounded-xl" style={{ backgroundColor: colors.surface }}>
                <Image source={logo} style={{ height: 44, width: 44 }} />
              </View>
              <Text className="text-2xl font-semibold" style={{ color: colors.text }}>
                When Did I Last
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Open account settings"
              className="ml-auto rounded-xl p-3"
              onPress={() => router.push('/account-settings')}
              style={{ backgroundColor: colors.surface }}
            >
              <UserRound color={colors.text} size={20} />
            </Pressable>
          </View>
        </View>

        <View className="gap-3">
          <View className="flex-row gap-3">
            <Pressable className="flex-1 items-center rounded-full border px-4 py-4" onPress={() => { void handleCreateCard(); }} style={{ backgroundColor: themeMode === 'dark' ? colors.surface : colors.primary, borderColor: themeMode === 'dark' ? colors.border : colors.primary }}>
              <Text className="text-sm font-semibold uppercase tracking-[1.5px]" style={{ color: themeMode === 'dark' ? colors.text : colors.primaryText }}>New card</Text>
            </Pressable>
            <Pressable className="flex-1 items-center rounded-full px-4 py-4" onPress={() => { void handleCreateFolder(); }} style={{ backgroundColor: colors.primary }}>
              <Text className="text-sm font-semibold uppercase tracking-[1.5px]" style={{ color: colors.primaryText }}>New folder</Text>
            </Pressable>
          </View>

          <View className="flex-row flex-wrap items-center gap-1 px-1 py-2">
            {currentFolderId ? (
              <Pressable accessibilityLabel="Back to parent folder" className="rounded-lg px-3 py-2" onPress={() => setCurrentFolderId(breadcrumbs.at(-2)?.id ?? null)} style={{ backgroundColor: colors.surface }}>
                <ArrowLeft color={colors.text} size={18} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => setCurrentFolderId(null)}>
              <Text className="px-1 text-sm" style={{ color: colors.muted }}>Cards</Text>
            </Pressable>
            {breadcrumbs.map((folder) => (
              <View className="flex-row items-center" key={folder.id}>
                <Text className="px-1 text-sm" style={{ color: colors.muted }}>/</Text>
                <Pressable onPress={() => setCurrentFolderId(folder.id)}>
                  <Text className="px-1 text-sm font-medium" style={{ color: colors.text }}>{folder.title || 'Untitled folder'}</Text>
                </Pressable>
              </View>
            ))}
          </View>

          {visibleFolders.length > 0 ? (
            <View className="gap-2">
              <Text className="mt-2 text-xs font-semibold uppercase tracking-[1.5px]" style={{ color: colors.muted }}>Folders</Text>
              {visibleFolders.map((folder) => (
                <Pressable className="flex-row items-center justify-between rounded-[18px] px-4 py-3" key={folder.id} onPress={() => {
                  if (folder.id !== editingFolderId) setCurrentFolderId(folder.id);
                }} style={{ backgroundColor: colors.mutedSurface }}>
                  <View className="min-w-0 grow flex-row items-center gap-2 pr-3">
                    <Folder color={colors.muted} size={20} />
                    {folder.id === editingFolderId ? (
                      <TextInput
                        autoFocus
                        className="grow border-b py-1 text-base"
                        onChangeText={setFolderTitle}
                        onSubmitEditing={() => { void handleSaveFolder(folder); }}
                        placeholder="Folder name"
                        placeholderTextColor="#6b7280"
                        style={{ borderColor: colors.border, color: colors.text }}
                        value={folderTitle}
                      />
                    ) : (
                      <Text className="shrink text-base font-semibold" numberOfLines={1} style={{ color: colors.text }}>{folder.title || 'Untitled folder'}</Text>
                    )}
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Pressable accessibilityLabel={`Move folder ${folder.title}`} className="rounded-xl px-3 py-2" onPress={() => setPicker({ itemId: folder.id, type: 'folder' })} style={{ backgroundColor: colors.surface }}>
                      <Text className="text-xs font-semibold" style={{ color: colors.text }}>Move</Text>
                    </Pressable>
                    {folder.id === editingFolderId ? (
                      <Pressable accessibilityLabel="Save folder" className="rounded-xl p-2" onPress={() => { void handleSaveFolder(folder); }} style={{ backgroundColor: colors.primary }}>
                        <Check color={colors.primaryText} size={20} />
                      </Pressable>
                    ) : (
                      <Pressable accessibilityLabel={`Edit folder ${folder.title}`} className="rounded-xl p-2" onPress={() => handleStartEditFolder(folder)} style={{ backgroundColor: colors.surface }}>
                        <Pencil color={colors.text} size={20} />
                      </Pressable>
                    )}
                    <Pressable accessibilityLabel={`Remove folder ${folder.title || 'Untitled folder'}`} className="rounded-xl p-2" onPress={() => { void handleDeleteFolder(folder); }} style={{ backgroundColor: colors.dangerSurface }}>
                      <Trash2 color={colors.danger} size={20} />
                    </Pressable>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          {visibleCards.length === 0 ? (
            <Text className="rounded-[24px] px-5 py-5 text-sm" style={{ backgroundColor: colors.surface, color: colors.muted }}>
              No encrypted cards in this folder yet.
            </Text>
          ) : (
            visibleCards.map((card) => {
              const isEditing = card.id === editingCardId;

              return (
                <View
                  className="rounded-[24px] border px-5 py-4"
                  key={card.id}
                  style={{ backgroundColor: colors.surface, borderColor: isEditing ? colors.text : colors.surface }}
                >
                  {isEditing ? (
                    <View className="flex-row items-center rounded-2xl px-1 py-1" style={{ backgroundColor: colors.mutedSurface }}>
                      <TextInput
                        autoCapitalize="sentences"
                        autoFocus
                        className="grow px-3 py-3 text-base"
                        onChangeText={setCardQuestion}
                        onSubmitEditing={() => {
                          void handleSaveCard(card.id);
                        }}
                        placeholder="water the plants"
                        placeholderTextColor={colors.muted}
                        returnKeyType="done"
                        value={cardQuestion}
                        style={{ color: colors.text }}
                      />
                      <View className="mr-2 rounded-full px-3 py-2" style={{ backgroundColor: colors.surface }}>
                        <Text className="text-lg font-semibold" style={{ color: colors.muted }}>?</Text>
                      </View>
                    </View>
                  ) : (
                    <Text className="text-base" style={{ color: colors.text }}>
                      {appendQuestionMark(card.question)}
                    </Text>
                  )}
                    <View className="my-3 h-px" style={{ backgroundColor: colors.border }} />
                    <Text className="text-lg font-semibold" style={{ color: colors.text }}>
                      {formatElapsedTime(card.lastDoneAt, now)}
                    </Text>
                  <View className="mt-4 flex-row items-center justify-end gap-2">
                    {isEditing ? (
                      <>
                        <Pressable
                          accessibilityLabel="Save card"
                          className="rounded-2xl p-3"
                          onPress={() => { void handleSaveCard(card.id); }}
                          style={{ backgroundColor: colors.primary }}
                        >
                          <Check color={colors.primaryText} size={20} />
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Cancel editing"
                          className="rounded-2xl p-3"
                          onPress={() => handleCancelEdit(card)}
                          style={{ backgroundColor: colors.mutedSurface }}
                        >
                          <X color={colors.text} size={20} />
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        accessibilityLabel="Edit card"
                        className="rounded-2xl p-3"
                        onPress={() => handleStartEdit(card)}
                        style={{ backgroundColor: colors.mutedSurface }}
                      >
                        <Pencil color={colors.text} size={20} />
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityLabel={`Move card ${card.question || 'Untitled card'}`}
                      className="rounded-2xl px-3 py-3"
                      onPress={() => setPicker({ itemId: card.id, type: 'card' })}
                      style={{ backgroundColor: colors.mutedSurface }}
                    >
                      <FolderOpen color={colors.text} size={20} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Show history for ${card.question || 'Untitled card'}`}
                      className="rounded-2xl p-3"
                      onPress={() => setHistoryCardId(card.id)}
                      style={{ backgroundColor: colors.mutedSurface }}
                    >
                      <ChartNoAxesColumnIncreasing color={colors.text} size={20} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Remove card"
                      className="rounded-2xl p-3"
                      onPress={() => { void handleDeleteCard(card.id); }}
                      style={{ backgroundColor: colors.dangerSurface }}
                    >
                      <Trash2 color={colors.danger} size={20} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Mark card as done now"
                      className="rounded-2xl px-4 py-3"
                      onPress={() => { void handleMarkNow(card.id); }}
                      style={{ backgroundColor: colors.primary }}
                    >
                      <Text className="font-semibold" style={{ color: colors.primaryText }}>Now</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
      <Modal animationType="slide" onRequestClose={() => setPicker(null)} transparent visible={picker !== null}>
        <View className="flex-1 justify-end bg-black/30">
          <View className="max-h-[70%] rounded-t-[28px] px-5 pb-10 pt-5" style={{ backgroundColor: colors.surface }}>
            <Text className="mb-3 text-lg font-semibold" style={{ color: colors.text }}>Move to folder</Text>
            <ScrollView>
              <Pressable
                className="border-b py-4"
                style={{ borderColor: colors.border }}
                onPress={() => {
                  if (picker?.type === 'card') {
                    const card = cards.find((entry) => entry.id === picker.itemId);
                    if (card) void handleMoveCard(card, null);
                  } else if (picker?.type === 'folder') {
                    const folder = folders.find((entry) => entry.id === picker.itemId);
                    if (folder) void handleMoveFolder(folder, null);
                  }
                  setPicker(null);
                }}
              >
                <Text className="text-base" style={{ color: colors.text }}>Top level</Text>
              </Pressable>
              {sortFolders(folders).filter((folder) => {
                return picker?.type !== 'folder' || canMoveFolder(picker.itemId, folder.id, folders);
              }).map((folder) => (
                <Pressable
                  className="border-b py-4"
                  style={{ borderColor: colors.border }}
                  key={folder.id}
                  onPress={() => {
                    if (picker?.type === 'card') {
                      const card = cards.find((entry) => entry.id === picker.itemId);
                      if (card) void handleMoveCard(card, folder.id);
                    } else if (picker?.type === 'folder') {
                      const source = folders.find((entry) => entry.id === picker.itemId);
                      if (source) void handleMoveFolder(source, folder.id);
                    }
                    setPicker(null);
                  }}
                >
                  <Text className="text-base" style={{ color: colors.text }}>{formatFolderLabel(folder, folders)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable className="mt-4 items-center rounded-2xl py-3" onPress={() => setPicker(null)} style={{ backgroundColor: colors.mutedSurface }}>
              <Text className="font-semibold" style={{ color: colors.text }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <HistoryModal card={cards.find((card) => card.id === historyCardId) ?? null} key={historyCardId ?? 'empty'} onClose={() => setHistoryCardId(null)} />
    </View>
  );
}

function HistoryModal({ card, onClose }: { card: DecryptedCard | null; onClose: () => void }) {
  const { themeMode } = useAppTheme();
  const colors = homeColors[themeMode];
  const history = card ? [...card.doneAtHistory].sort((left, right) => left.localeCompare(right)) : [];
  const initialView = chooseMobileHistoryView(history);
  const [cutoff, setCutoff] = useState<HistoryCutoff>(initialView.cutoff);
  const [resolution, setResolution] = useState<HistoryResolution>(initialView.resolution);
  const series = buildMobileHistorySeries(history, cutoff, resolution);
  const largestCount = Math.max(...series.map((entry) => entry.count), 1);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={card !== null}>
      <View className="flex-1 justify-end bg-black/30">
        <View className="rounded-t-[28px] px-5 pb-10 pt-5" style={{ backgroundColor: colors.surface }}>
          <View className="flex-row items-start justify-between gap-3">
            <View className="grow">
              <Text className="text-xs font-semibold uppercase tracking-[1.5px]" style={{ color: colors.muted }}>Completion history</Text>
              <Text className="mt-1 text-lg font-semibold" style={{ color: colors.text }}>{appendQuestionMark(card?.question ?? '')}</Text>
            </View>
            <Pressable accessibilityLabel="Close history" className="rounded-xl p-2" onPress={onClose} style={{ backgroundColor: colors.mutedSurface }}>
              <X color={colors.text} size={20} />
            </Pressable>
          </View>
          {history.length === 0 ? (
            <Text className="mt-6 text-sm" style={{ color: colors.muted }}>No completion history yet.</Text>
          ) : (
            <>
              <Text className="mt-5 text-xs font-semibold uppercase tracking-[1.5px] text-neutral-600">Resolution</Text>
              <ScrollView className="mt-2" horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {historyResolutions.map((entry) => (
                    <Pressable className="rounded-xl px-3 py-2" key={entry.value} onPress={() => setResolution(entry.value)} style={{ backgroundColor: resolution === entry.value ? colors.primary : colors.mutedSurface }}>
                      <Text className="text-xs font-semibold" style={{ color: resolution === entry.value ? colors.primaryText : colors.text }}>{entry.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <Text className="mt-4 text-xs font-semibold uppercase tracking-[1.5px] text-neutral-600">Cutoff</Text>
              <ScrollView className="mt-2" horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {historyCutoffs.map((entry) => (
                    <Pressable className="rounded-xl px-3 py-2" key={entry.value} onPress={() => setCutoff(entry.value)} style={{ backgroundColor: cutoff === entry.value ? colors.primary : colors.mutedSurface }}>
                      <Text className="text-xs font-semibold" style={{ color: cutoff === entry.value ? colors.primaryText : colors.text }}>{entry.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View className="mt-6 h-40 flex-row">
                <View className="h-full w-10 justify-between pr-2">
                  <Text className="text-right text-xs text-neutral-600">{largestCount}</Text>
                  <Text className="text-right text-xs text-neutral-600">{Math.ceil(largestCount / 2)}</Text>
                  <Text className="text-right text-xs text-neutral-600">0</Text>
                </View>
                <View className="h-full grow border-b border-l border-neutral-300 pb-1">
                  <View className="h-full flex-row items-end gap-1">
                    {series.map((entry) => (
                      <View className="flex-1 justify-end" key={entry.key}>
                        <View className="min-h-2 rounded-t bg-[#47474d]" style={{ height: `${Math.max(12, Math.round((entry.count / largestCount) * 100))}%` }} />
                      </View>
                    ))}
                  </View>
                </View>
              </View>
              <View className="mt-3 flex-row justify-between gap-3">
                <Text className="text-xs text-neutral-600">{series[0]?.label ?? 'No completions in this range'}</Text>
                <Text className="text-right text-xs text-neutral-600">{series.at(-1)?.label ?? ''}</Text>
              </View>
              <ScrollView className="mt-4 max-h-32 border-t border-neutral-200 pt-2">
                {filterMobileHistoryByCutoff(history, cutoff).slice().reverse().map((timestamp) => <Text className="py-1 text-sm text-neutral-800" key={timestamp}>{formatHistoryTimestamp(timestamp)}</Text>)}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function chooseMobileHistoryView(history: string[]) {
  const span = history.length > 1 ? Date.now() - Date.parse(history[0]!) : 0;
  if (span > 365 * 24 * 60 * 60 * 1000) return { cutoff: 'all' as const, resolution: 'month' as const };
  if (span > 30 * 24 * 60 * 60 * 1000) return { cutoff: '1y' as const, resolution: 'week' as const };
  if (span > 7 * 24 * 60 * 60 * 1000) return { cutoff: '30d' as const, resolution: 'day' as const };
  if (span > 24 * 60 * 60 * 1000) return { cutoff: '7d' as const, resolution: 'hour' as const };
  if (span > 60 * 60 * 1000) return { cutoff: '24h' as const, resolution: 'hour' as const };
  return { cutoff: '1h' as const, resolution: 'minute' as const };
}

function buildMobileHistorySeries(history: string[], cutoff: HistoryCutoff, resolution: HistoryResolution) {
  if (history.length === 0) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const timestamp of filterMobileHistoryByCutoff(history, cutoff)) {
    const date = new Date(timestamp);
    const key = getMobileHistoryBucketKey(date, resolution);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const start = getMobileHistorySeriesStart(history, cutoff, resolution);
  const end = getMobileHistoryBucketStart(new Date(), resolution);
  const series: Array<{ count: number; key: string; label: string }> = [];
  const cursor = new Date(start);

  while (cursor <= end && series.length < 2_000) {
    const key = getMobileHistoryBucketKey(cursor, resolution);
    series.push({ count: counts.get(key) ?? 0, key, label: formatMobileHistoryBucket(cursor, resolution) });
    advanceMobileHistoryBucket(cursor, resolution);
  }

  return series;
}

function getMobileHistorySeriesStart(history: string[], cutoff: HistoryCutoff, resolution: HistoryResolution) {
  const cutoffMilliseconds: Record<Exclude<HistoryCutoff, 'all'>, number> = {
    '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000, '1y': 365 * 24 * 60 * 60 * 1000,
  };
  const start = cutoff === 'all' ? new Date(history[0]!) : new Date(Date.now() - cutoffMilliseconds[cutoff]);
  return getMobileHistoryBucketStart(start, resolution);
}

function getMobileHistoryBucketStart(date: Date, resolution: HistoryResolution) {
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

function advanceMobileHistoryBucket(date: Date, resolution: HistoryResolution) {
  if (resolution === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  if (resolution === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  if (resolution === 'week') date.setUTCDate(date.getUTCDate() + 7);
  if (resolution === 'day') date.setUTCDate(date.getUTCDate() + 1);
  if (resolution === 'hour') date.setUTCHours(date.getUTCHours() + 1);
  if (resolution === 'minute') date.setUTCMinutes(date.getUTCMinutes() + 1);
}

function filterMobileHistoryByCutoff(history: string[], cutoff: HistoryCutoff) {
  const cutoffMilliseconds: Record<Exclude<HistoryCutoff, 'all'>, number> = {
    '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000, '1y': 365 * 24 * 60 * 60 * 1000,
  };
  const threshold = cutoff === 'all' ? null : Date.now() - cutoffMilliseconds[cutoff];
  return threshold === null ? history : history.filter((timestamp) => Date.parse(timestamp) >= threshold);
}

function getMobileHistoryBucketKey(date: Date, resolution: HistoryResolution) {
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

function formatMobileHistoryBucket(date: Date, resolution: HistoryResolution) {
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
    title: note.title,
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

function buildInitialCardSyncMessage(cardCount: number) {
  if (cardCount === 0) {
    return 'No synced cards yet. Create one to push ciphertext to the backend.';
  }

  return `Loaded ${cardCount} encrypted card${cardCount === 1 ? '' : 's'} from the local offline store.`;
}

function buildOfflineSyncFailureMessage(noteCount: number, error: unknown) {
  if (noteCount > 0) {
    return `Loaded ${noteCount} offline card${noteCount === 1 ? '' : 's'}. Sync will resume when the backend is reachable.`;
  }

  return error instanceof Error ? error.message : 'Unable to sync encrypted cards.';
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

function appendQuestionMark(question: string) {
  return question.trim().endsWith('?') ? question.trim() : `${question.trim()}?`;
}

function formatHistoryTimestamp(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
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
