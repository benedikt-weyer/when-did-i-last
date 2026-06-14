import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { subscribeToNoteEvents } from '@repo/realtime';

import { ScreenShell } from '../components/screen-shell';
import {
  createMobileOfflineNotesSyncAdapter,
  getMobileOfflineNotesProvider,
} from '../features/e2ee/offline-notes';
import { useAuth } from '../features/auth/auth-context';
import type { AuthApiResponse } from '../features/auth/auth-api';
import { useAppTheme } from '../features/theme/theme-context';
import { themeTokens } from '../theme/theme-tokens';

type DecryptedNote = {
  content: string;
  createdAt: string;
  id: string;
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
  const { themeMode } = useAppTheme();
  const tokens = themeTokens[themeMode];
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [notes, setNotes] = useState<DecryptedNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const selectedNoteIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const applyOfflineSnapshot = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }

    const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();

    const nextNotes = sortNotes(
      mobileOfflineNotesProvider.getSnapshot().notes.map((note) => toNoteRecord(note)),
    );

    setNotes(nextNotes);

    const nextSelectedNote =
      nextNotes.find((note) => note.id === selectedNoteIdRef.current) ??
      nextNotes[0] ??
      null;

    applySelectedNote(nextSelectedNote);
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
          error instanceof Error ? error.message : 'Unable to initialize the offline notes store.',
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
      const noteCount = mobileOfflineNotesProvider.getSnapshot().notes.length;

      setStatusMessage(buildInitialNoteSyncMessage(noteCount));
    }).catch(async (error) => {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const noteCount = mobileOfflineNotesProvider.getSnapshot().notes.length;

      setStatusMessage(buildOfflineSyncFailureMessage(noteCount, error));
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
                : 'Unable to sync encrypted notes after the realtime update.',
            );
          });
        },
      });

      return () => {
        subscription.close();
      };
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to connect note realtime updates.',
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

  function applySelectedNote(note: DecryptedNote | null) {
    selectedNoteIdRef.current = note?.id ?? null;
    setSelectedNoteId(note?.id ?? null);
    setNoteTitle(note?.title ?? '');
    setNoteContent(note?.content ?? '');
  }

  function handleCreateDraft() {
    applySelectedNote(null);
    setStatusMessage('Creating a new encrypted note draft.');
  }

  function handleSelectNote(noteId: string) {
    const nextNote = notes.find((note) => note.id === noteId) ?? null;

    applySelectedNote(nextNote);
    setStatusMessage(nextNote ? `Selected "${nextNote.title || 'Untitled note'}".` : '');
  }

  async function handleSave() {
    try {
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();
      const savedNote = toNoteRecord(await mobileOfflineNotesProvider.saveNote({
        content: noteContent,
        id: selectedNoteId ?? undefined,
        title: noteTitle,
      }));
      const actionLabel = selectedNoteId ? 'Updated' : 'Created';

      applySelectedNote(savedNote);

      if (!session || linkedKeks.length === 0 || !activeKekId) {
        setStatusMessage(
          `${actionLabel} "${savedNote.title || 'Untitled note'}" locally. Sync pending.`,
        );
        return;
      }

      try {
        await syncOfflineNotes({
          activeLinkedKekId: activeKekId,
          linkedKeks,
          nextSession: session,
        });
        setStatusMessage(`${actionLabel} "${savedNote.title || 'Untitled note'}".`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? `${actionLabel} "${savedNote.title || 'Untitled note'}" locally. ${error.message}`
            : `${actionLabel} "${savedNote.title || 'Untitled note'}" locally. Sync pending.`,
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to save the encrypted note.',
      );
    }
  }

  async function handleClear() {
    if (!selectedNoteId) {
      applySelectedNote(null);
      setStatusMessage('Cleared the local note draft.');
      return;
    }

    try {
      const deletedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
      const mobileOfflineNotesProvider = await getMobileOfflineNotesProvider();

      await mobileOfflineNotesProvider.deleteNote(selectedNoteId);

      if (!session || linkedKeks.length === 0 || !activeKekId) {
        setStatusMessage(`Deleted "${deletedNote?.title || 'Untitled note'}" locally. Sync pending.`);
        return;
      }

      try {
        await syncOfflineNotes({
          activeLinkedKekId: activeKekId,
          linkedKeks,
          nextSession: session,
        });
        setStatusMessage(`Deleted "${deletedNote?.title || 'Untitled note'}".`);
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? `Deleted "${deletedNote?.title || 'Untitled note'}" locally. ${error.message}`
            : `Deleted "${deletedNote?.title || 'Untitled note'}" locally. Sync pending.`,
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to delete the encrypted note.',
      );
    }
  }

  return (
    <ScreenShell
      themeMode={themeMode}
      title="Home"
    >
      <Text className={`text-sm ${tokens.body}`}>
        Signed in as {session?.user.email ?? 'unknown'}
      </Text>

      <View className="gap-3">
        <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
          Notes
        </Text>
        <View className="gap-2">
          <Pressable
            className="items-center rounded-full border border-stone-300 px-4 py-3 dark:border-slate-700"
            onPress={() => {
              handleCreateDraft();
            }}
          >
            <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.title}`}>
              New note
            </Text>
          </Pressable>
        </View>
        <View className="gap-2">
          {notes.length === 0 ? (
            <Text className={`rounded-[22px] border border-dashed px-4 py-4 text-sm ${tokens.body}`}>
              No encrypted notes yet.
            </Text>
          ) : (
            notes.map((note) => {
              const isActive = note.id === selectedNoteId;

              return (
                <Pressable
                  className={`rounded-[22px] border px-4 py-4 ${isActive ? tokens.segmentActive : tokens.card}`}
                  key={note.id}
                  onPress={() => {
                    handleSelectNote(note.id);
                  }}
                >
                  <Text className={`text-sm font-semibold ${isActive ? tokens.segmentActiveText : tokens.title}`}>
                    {note.title || 'Untitled note'}
                  </Text>
                  <Text className={`mt-1 text-sm ${isActive ? tokens.segmentActiveText : tokens.body}`} numberOfLines={1}>
                    {note.content || 'No content yet'}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
        <TextInput
          autoCapitalize="sentences"
          className={`rounded-[22px] border px-4 py-3 text-base ${tokens.card} ${tokens.title}`}
          onChangeText={setNoteTitle}
          placeholder="Untitled note"
          placeholderTextColor={themeMode === 'dark' ? '#94a3b8' : '#78716c'}
          value={noteTitle}
        />
        <TextInput
          className={`min-h-[150px] rounded-[22px] border px-4 py-4 text-base ${tokens.card} ${tokens.title}`}
          multiline
          onChangeText={setNoteContent}
          placeholder="Write something that should stay encrypted between web and mobile"
          placeholderTextColor={themeMode === 'dark' ? '#94a3b8' : '#78716c'}
          textAlignVertical="top"
          value={noteContent}
        />
        <View className="flex-row gap-3">
          <Pressable
            className={`flex-1 items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
            onPress={() => {
              void handleSave();
            }}
          >
            <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
              {selectedNoteId ? 'Update note' : 'Create note'}
            </Text>
          </Pressable>
          <Pressable
            className="flex-1 items-center rounded-full border border-stone-300 px-4 py-4 dark:border-slate-700"
            onPress={() => {
              void handleClear();
            }}
          >
            <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.title}`}>
              {selectedNoteId ? 'Delete note' : 'Clear draft'}
            </Text>
          </Pressable>
        </View>
        {statusMessage ? <Text className={`text-sm ${tokens.body}`}>{statusMessage}</Text> : null}
      </View>
    </ScreenShell>
  );
}

function toNoteRecord(note: {
  content: string;
  createdAt: string;
  id: string;
  title: string;
  updatedAt: string;
}) {
  return {
    content: note.content,
    createdAt: note.createdAt,
    id: note.id,
    title: note.title,
    updatedAt: note.updatedAt,
  };
}

function buildInitialNoteSyncMessage(noteCount: number) {
  if (noteCount === 0) {
    return 'No synced notes yet. Create one to push ciphertext to the backend.';
  }

  return `Loaded ${noteCount} encrypted note${noteCount === 1 ? '' : 's'} from the local offline store.`;
}

function buildOfflineSyncFailureMessage(noteCount: number, error: unknown) {
  if (noteCount > 0) {
    return `Loaded ${noteCount} offline note${noteCount === 1 ? '' : 's'}. Sync will resume when the backend is reachable.`;
  }

  return error instanceof Error ? error.message : 'Unable to sync encrypted notes.';
}

function sortNotes(notes: DecryptedNote[]) {
  return [...notes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}