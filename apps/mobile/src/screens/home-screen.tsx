import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { subscribeToNoteEvents } from '@repo/realtime';
import { Ionicons } from '@expo/vector-icons';

import {
  createMobileOfflineNotesSyncAdapter,
  getMobileOfflineNotesProvider,
} from '../features/e2ee/offline-notes';
import { useAuth } from '../features/auth/auth-context';
import type { AuthApiResponse } from '../features/auth/auth-api';

type DecryptedCard = {
  createdAt: string;
  id: string;
  lastDoneAt: string | null;
  question: string;
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

    const nextCards = sortCards(
      mobileOfflineNotesProvider.getSnapshot().notes.map((note) => toCardRecord(note)),
    );

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
        content: '',
        title: '',
      }));

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
        content: selectedCard?.lastDoneAt ?? '',
        id: selectedCard.id,
        title: cardQuestion.trim(),
      }));
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
        content: new Date().toISOString(),
        id: card.id,
        title: card.question,
      }));

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
          <Pressable
            className="items-center rounded-full bg-[#47474d] px-4 py-4"
            onPress={() => {
              handleCreateCard();
            }}
          >
            <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-white">
              New card
            </Text>
          </Pressable>

          {cards.length === 0 ? (
            <Text className="rounded-[24px] bg-white px-5 py-5 text-sm text-neutral-700">
              No encrypted cards yet.
            </Text>
          ) : (
            cards.map((card) => {
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
    </View>
  );
}

function toCardRecord(note: {
  content: string;
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
}) {
  return {
    createdAt: note.createdAt,
    id: note.id,
    lastDoneAt: normalizeLastDoneAt(note.content),
    question: note.title,
    title: note.title,
    updatedAt: note.updatedAt,
  };
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

function normalizeLastDoneAt(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  return Number.isNaN(Date.parse(trimmedValue)) ? null : trimmedValue;
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
