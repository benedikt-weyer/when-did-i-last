import { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ThemeMode } from '../features/theme/theme-storage';
import { themeTokens } from '../theme/theme-tokens';

type ScreenShellProps = Readonly<{
  children: ReactNode;
  themeMode: ThemeMode;
  title: string;
}>;

export function ScreenShell({
  children,
  themeMode,
  title,
}: ScreenShellProps) {
  const tokens = themeTokens[themeMode];

  return (
    <SafeAreaView className={`flex-1 ${tokens.screen}`} edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: 32,
          paddingHorizontal: 24,
          paddingTop: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-6 gap-2 px-1 py-1">
          <Text className={`text-3xl font-semibold ${tokens.title}`}>{title}</Text>
        </View>
        <View className="gap-4">{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}