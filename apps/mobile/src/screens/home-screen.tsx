import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { subscribeToNoteEvents } from '@repo/realtime';

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
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
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
    setSelectedCardId(card?.id ?? null);
    setCardQuestion(card?.question ?? '');
  }

  function handleCreateCard() {
    applySelectedCard(null);
    setStatusMessage('Creating a new encrypted card draft.');
  }

  function handleSelectCard(cardId: string) {
    const nextCard = cards.find((card) => card.id === cardId) ?? null;

    applySelectedCard(nextCard);
    setStatusMessage(nextCard ? `Selected "${nextCard.question || 'Untitled card'}".` : '');
  }

  async function handleSaveCard() {
    const trimmedQuestion = cardQuestion.trim();

    if (!trimmedQuestion) {
      setStatusMessage('Enter a question before saving the card.');
      return;
    }

    try {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const selectedCard = cards.find((card) => card.id === selectedCardId) ?? null;
      const savedCard = toCardRecord(await mobileOfflineNotesProvider.saveNote({
        content: selectedCard?.lastDoneAt ?? '',
        id: selectedCardId ?? undefined,
        title: trimmedQuestion,
      }));
      const actionLabel = selectedCardId ? 'Updated' : 'Created';

      applySelectedCard(savedCard);

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

  async function handleDeleteCard() {
    if (!selectedCardId) {
      applySelectedCard(null);
      setStatusMessage('Cleared the local card draft.');
      return;
    }

    try {
      const deletedCard = cards.find((card) => card.id === selectedCardId) ?? null;
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();

      await mobileOfflineNotesProvider.deleteNote(selectedCardId);

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
            source={require('../../assets/when-did-i-last-logo-bg-s.png')}
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
              const isActive = card.id === selectedCardId;

              return (
                <View className="flex-row items-stretch gap-3" key={card.id}>
                  <Pressable
                    className={`grow rounded-[24px] border bg-white px-5 py-4 ${isActive ? 'border-neutral-800' : 'border-transparent'}`}
                    onPress={() => {
                      handleSelectCard(card.id);
                    }}
                  >
                    <Text className="text-base text-neutral-900">
                      {appendQuestionMark(card.question)}
                    </Text>
                    <View className="my-3 h-px bg-neutral-200" />
                    <Text className="text-lg font-semibold text-neutral-800">
                      {formatElapsedTime(card.lastDoneAt, now)}
                    </Text>
                  </Pressable>
                  <Pressable
                    className="self-center rounded-2xl bg-white px-4 py-4"
                    onPress={() => {
                      void handleMarkNow(card.id);
                    }}
                  >
                    <Text className="font-semibold text-neutral-800">Now</Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </View>

        <View className="mt-6 gap-3">
          <Text className="text-base font-medium text-neutral-800">When did I last...</Text>
          <View className="flex-row items-center rounded-[24px] bg-white px-1 py-1">
            <TextInput
              autoCapitalize="sentences"
              className="grow px-4 py-4 text-base text-neutral-900"
              onChangeText={setCardQuestion}
              placeholder="water the plants"
              placeholderTextColor="#6b7280"
              value={cardQuestion}
            />
            <View className="mr-3 rounded-full bg-neutral-100 px-3 py-2">
              <Text className="text-lg font-semibold text-neutral-700">?</Text>
            </View>
          </View>
          <View className="flex-row gap-3">
            <Pressable
              className="items-center justify-center rounded-2xl bg-[#f54848] px-4 py-4"
              onPress={() => {
                void handleDeleteCard();
              }}
            >
              <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-white">
                {selectedCardId ? 'Delete' : 'Clear'}
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 items-center rounded-2xl bg-[#111111] px-4 py-4"
              onPress={() => {
                void handleSaveCard();
              }}
            >
              <Text className="text-sm font-semibold uppercase tracking-[1.5px] text-white">
                {selectedCardId ? 'Save card' : 'Create card'}
              </Text>
            </Pressable>
          </View>
          {statusMessage ? (
            <Text className="text-sm leading-6 text-neutral-700">{statusMessage}</Text>
          ) : null}
        </View>
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