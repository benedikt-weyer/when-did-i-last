import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { subscribeToNoteEvents } from '@repo/realtime';
import { Ionicons } from '@expo/vector-icons';
import {
  MAX_FOLDER_DEPTH,
  parseNoteOrganization,
  serializeCardOrganization,
} from '@repo/offline-provider';

import {
  createMobileOfflineNotesSyncAdapter,
  getMobileOfflineNotesProvider,
} from '../features/e2ee/offline-notes';
import { fetchFolders, saveFolder } from '../features/e2ee/folder-api';
import { getNativeAuthModule } from '../features/e2ee/native-runtime';
import { useAuth } from '../features/auth/auth-context';
import type { AuthApiResponse } from '../features/auth/auth-api';

type DecryptedCard = {
  createdAt: string;
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

// Expo resolves bundled image assets through require at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../assets/when-did-i-last-logo-bg-s.png');

export function HomeScreen() {
  const {
    activeKekId,
    backendUrl,
    linkedKeks,
    refreshKekMigrationStatus,
    runWithFreshSession,
    session,
  } = useAuth();
  const [cardQuestion, setCardQuestion] = useState('');
  const [cards, setCards] = useState<DecryptedCard[]>([]);
  const [folders, setFolders] = useState<DecryptedFolder[]>([]);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderTitle, setFolderTitle] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ itemId: string; type: 'card' | 'folder' } | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const selectedCardIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const [statusMessage, setStatusMessage] = useState('');
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
        content: serializeCardOrganization({ folderId: currentFolderId, lastDoneAt: null }),
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
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const savedCard = toCardRecord(await mobileOfflineNotesProvider.saveNote({
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

  return (
    <View className="flex-1 bg-[#F5EFB9]">
      <StatusBar style="dark" />
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
        <View className="items-center pb-6 pt-4">
          <Image
            source={logo}
            style={{ height: 88, width: 88 }}
          />
          <Text className="mt-5 text-center text-4xl font-semibold text-neutral-800">
            When did I last...
          </Text>
          <Text className="mt-2 text-sm text-neutral-700">
            Signed in as {session?.user.email ?? 'unknown'}
          </Text>
        </View>

        <View className="gap-3">
          <View className="flex-row gap-3">
            <Pressable className="flex-1 items-center rounded-full bg-[#47474d] px-4 py-4" onPress={() => { void handleCreateCard(); }}>
              <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-white">New card</Text>
            </Pressable>
            <Pressable className="flex-1 items-center rounded-full bg-[#202d47] px-4 py-4" onPress={() => { void handleCreateFolder(); }}>
              <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-white">New folder</Text>
            </Pressable>
          </View>

          <View className="flex-row flex-wrap items-center gap-1 px-1 py-2">
            {currentFolderId ? (
              <Pressable accessibilityLabel="Back to parent folder" className="rounded-lg bg-white px-3 py-2" onPress={() => setCurrentFolderId(breadcrumbs.at(-2)?.id ?? null)}>
                <Ionicons color="#262626" name="arrow-back" size={18} />
              </Pressable>
            ) : null}
            <Pressable onPress={() => setCurrentFolderId(null)}>
              <Text className="px-1 text-sm text-neutral-700">Cards</Text>
            </Pressable>
            {breadcrumbs.map((folder) => (
              <View className="flex-row items-center" key={folder.id}>
                <Text className="px-1 text-sm text-neutral-500">/</Text>
                <Pressable onPress={() => setCurrentFolderId(folder.id)}>
                  <Text className="px-1 text-sm font-medium text-neutral-900">{folder.title || 'Untitled folder'}</Text>
                </Pressable>
              </View>
            ))}
          </View>

          {visibleFolders.length > 0 ? (
            <View className="gap-2">
              <Text className="mt-2 text-xs font-semibold uppercase tracking-[1.5px] text-neutral-600">Folders</Text>
              {visibleFolders.map((folder) => (
                <Pressable className="flex-row items-center justify-between rounded-[18px] bg-[#e9edf1] px-4 py-3" key={folder.id} onPress={() => {
                  if (folder.id !== editingFolderId) setCurrentFolderId(folder.id);
                }}>
                  <View className="max-w-[62%] flex-row items-center gap-2">
                    <Ionicons color="#404040" name="folder-outline" size={20} />
                    {folder.id === editingFolderId ? (
                      <TextInput
                        autoFocus
                        className="grow border-b border-neutral-300 py-1 text-base text-neutral-900"
                        onChangeText={setFolderTitle}
                        onSubmitEditing={() => { void handleSaveFolder(folder); }}
                        placeholder="Folder name"
                        placeholderTextColor="#6b7280"
                        value={folderTitle}
                      />
                    ) : (
                      <Text className="shrink text-base font-semibold text-neutral-900" numberOfLines={1}>{folder.title || 'Untitled folder'}</Text>
                    )}
                  </View>
                  <Pressable accessibilityLabel={`Move folder ${folder.title}`} className="rounded-xl bg-white px-3 py-2" onPress={() => setPicker({ itemId: folder.id, type: 'folder' })}>
                    <Text className="text-xs font-semibold text-neutral-800">Move</Text>
                  </Pressable>
                  {folder.id === editingFolderId ? (
                    <Pressable accessibilityLabel="Save folder" className="rounded-xl bg-neutral-900 p-2" onPress={() => { void handleSaveFolder(folder); }}>
                      <Ionicons color="#ffffff" name="checkmark" size={20} />
                    </Pressable>
                  ) : (
                    <Pressable accessibilityLabel={`Edit folder ${folder.title}`} className="rounded-xl bg-white p-2" onPress={() => handleStartEditFolder(folder)}>
                      <Ionicons color="#262626" name="pencil-outline" size={20} />
                    </Pressable>
                  )}
                </Pressable>
              ))}
            </View>
          ) : null}

          {visibleCards.length === 0 ? (
            <Text className="rounded-[24px] bg-white px-5 py-5 text-sm text-neutral-700">
              No encrypted cards in this folder yet.
            </Text>
          ) : (
            visibleCards.map((card) => {
              const isEditing = card.id === editingCardId;

              return (
                <View
                  className={`rounded-[24px] border bg-white px-5 py-4 ${isEditing ? 'border-neutral-800' : 'border-transparent'}`}
                  key={card.id}
                >
                  {isEditing ? (
                    <View className="flex-row items-center rounded-2xl bg-neutral-100 px-1 py-1">
                      <TextInput
                        autoCapitalize="sentences"
                        autoFocus
                        className="grow px-3 py-3 text-base text-neutral-900"
                        onChangeText={setCardQuestion}
                        onSubmitEditing={() => {
                          void handleSaveCard(card.id);
                        }}
                        placeholder="water the plants"
                        placeholderTextColor="#6b7280"
                        returnKeyType="done"
                        value={cardQuestion}
                      />
                      <View className="mr-2 rounded-full bg-white px-3 py-2">
                        <Text className="text-lg font-semibold text-neutral-700">?</Text>
                      </View>
                    </View>
                  ) : (
                    <Text className="text-base text-neutral-900">
                      {appendQuestionMark(card.question)}
                    </Text>
                  )}
                    <View className="my-3 h-px bg-neutral-200" />
                    <Text className="text-lg font-semibold text-neutral-800">
                      {formatElapsedTime(card.lastDoneAt, now)}
                    </Text>
                  <View className="mt-4 flex-row items-center justify-end gap-2">
                    {isEditing ? (
                      <>
                        <Pressable
                          accessibilityLabel="Save card"
                          className="rounded-2xl bg-neutral-900 p-3"
                          onPress={() => { void handleSaveCard(card.id); }}
                        >
                          <Ionicons color="#ffffff" name="checkmark" size={20} />
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Cancel editing"
                          className="rounded-2xl bg-neutral-100 p-3"
                          onPress={() => handleCancelEdit(card)}
                        >
                          <Ionicons color="#262626" name="close" size={20} />
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        accessibilityLabel="Edit card"
                        className="rounded-2xl bg-neutral-100 p-3"
                        onPress={() => handleStartEdit(card)}
                      >
                        <Ionicons color="#262626" name="pencil-outline" size={20} />
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityLabel="Mark card as done now"
                      className="rounded-2xl bg-neutral-100 px-4 py-3"
                      onPress={() => { void handleMarkNow(card.id); }}
                    >
                      <Text className="font-semibold text-neutral-800">Now</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Move card ${card.question || 'Untitled card'}`}
                      className="rounded-2xl bg-neutral-100 px-3 py-3"
                      onPress={() => setPicker({ itemId: card.id, type: 'card' })}
                    >
                      <Ionicons color="#262626" name="folder-open-outline" size={20} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Remove card"
                      className="rounded-2xl bg-red-50 p-3"
                      onPress={() => { void handleDeleteCard(card.id); }}
                    >
                      <Ionicons color="#c2410c" name="trash-outline" size={20} />
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
        {statusMessage ? (
          <Text className="mt-6 text-sm leading-6 text-neutral-700">{statusMessage}</Text>
        ) : null}
      </ScrollView>
      <Modal animationType="slide" onRequestClose={() => setPicker(null)} transparent visible={picker !== null}>
        <View className="flex-1 justify-end bg-black/30">
          <View className="max-h-[70%] rounded-t-[28px] bg-white px-5 pb-10 pt-5">
            <Text className="mb-3 text-lg font-semibold text-neutral-900">Move to folder</Text>
            <ScrollView>
              <Pressable
                className="border-b border-neutral-100 py-4"
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
                <Text className="text-base text-neutral-900">Top level</Text>
              </Pressable>
              {sortFolders(folders).filter((folder) => {
                return picker?.type !== 'folder' || canMoveFolder(picker.itemId, folder.id, folders);
              }).map((folder) => (
                <Pressable
                  className="border-b border-neutral-100 py-4"
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
                  <Text className="text-base text-neutral-900">{formatFolderLabel(folder, folders)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable className="mt-4 items-center rounded-2xl bg-neutral-100 py-3" onPress={() => setPicker(null)}>
              <Text className="font-semibold text-neutral-800">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
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
