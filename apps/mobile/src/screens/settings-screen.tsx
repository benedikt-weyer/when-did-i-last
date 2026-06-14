import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { ScreenShell } from '../components/screen-shell';
import { useAuth } from '../features/auth/auth-context';
import { ThemeModeToggle } from '../components/theme-mode-toggle';
import { useAppTheme } from '../features/theme/theme-context';
import { themeTokens } from '../theme/theme-tokens';

export function SettingsScreen() {
  const { backendUrl, signOut, updateBackendUrl } = useAuth();
  const { setThemeMode, themeMode } = useAppTheme();
  const router = useRouter();
  const tokens = themeTokens[themeMode];
  const [backendUrlInput, setBackendUrlInput] = useState(backendUrl);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    setBackendUrlInput(backendUrl);
  }, [backendUrl]);

  async function handleSaveBackendUrl() {
    await updateBackendUrl(backendUrlInput);
    setSaveMessage('Backend URL updated.');
  }

  return (
    <ScreenShell
      themeMode={themeMode}
      title="Settings"
    >
      <ThemeModeToggle onChange={setThemeMode} themeMode={themeMode} />

      <View className="gap-3">
        <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
          Backend
        </Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className={`rounded-[22px] border px-4 py-4 text-base ${tokens.card} ${tokens.title}`}
          onChangeText={setBackendUrlInput}
          placeholder="http://127.0.0.1:4000"
          placeholderTextColor={themeMode === 'dark' ? '#94a3b8' : '#78716c'}
          value={backendUrlInput}
        />
        <Pressable
          className={`items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
          onPress={() => {
            void handleSaveBackendUrl();
          }}
        >
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
            Save backend URL
          </Text>
        </Pressable>
        {saveMessage ? <Text className={`text-sm ${tokens.body}`}>{saveMessage}</Text> : null}
      </View>

      <View className="gap-3">
        <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
          Account
        </Text>
        <Pressable
          className={`items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
          onPress={() => {
            router.push('/account-settings');
          }}
        >
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
            Open account settings
          </Text>
        </Pressable>
      </View>

      <View className="gap-3">
        <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
          Data
        </Text>
        <Pressable
          className={`items-center rounded-full px-4 py-4 ${tokens.segmentActive}`}
          onPress={() => {
            router.push('/import-export');
          }}
        >
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.segmentActiveText}`}>
            Open import / export
          </Text>
        </Pressable>
      </View>

      <View className="gap-3">
        <Text className={`text-sm uppercase tracking-[2px] ${tokens.kicker}`}>
          Session
        </Text>
        <Pressable
          className="items-center rounded-full border border-stone-300 px-4 py-4 dark:border-slate-700"
          onPress={() => {
            void signOut();
          }}
        >
          <Text className={`text-sm font-semibold uppercase tracking-[1.5px] ${tokens.title}`}>
            Sign out
          </Text>
        </Pressable>
      </View>
    </ScreenShell>
  );
}