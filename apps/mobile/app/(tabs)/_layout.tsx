import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import type { ColorValue } from 'react-native';

import { useAppTheme } from '../../src/features/theme/theme-context';
import { themeTokens } from '../../src/theme/theme-tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type TabBarIconRenderer = (props: {
  color: ColorValue;
  focused: boolean;
  size: number;
}) => ReactNode;

function createTabBarIcon(
  activeName: IoniconName,
  inactiveName: IoniconName,
): TabBarIconRenderer {
  return ({ color, focused, size }) => (
    <Ionicons
      color={String(color)}
      name={focused ? activeName : inactiveName}
      size={size}
    />
  );
}

const renderHomeTabIcon = createTabBarIcon('home', 'home-outline');
const renderSettingsTabIcon = createTabBarIcon('settings', 'settings-outline');

export default function TabsLayout() {
  const { themeMode } = useAppTheme();
  const tokens = themeTokens[themeMode];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: {
          backgroundColor: tokens.sceneBackground,
        },
        tabBarActiveTintColor: tokens.tabBarActiveTint,
        tabBarInactiveTintColor: tokens.tabBarInactiveTint,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
        tabBarItemStyle: {
          paddingVertical: 6,
        },
        tabBarStyle: {
          backgroundColor: tokens.tabBarBackground,
          borderTopColor: tokens.tabBarBorder,
          borderTopWidth: 1,
          height: 72,
          paddingBottom: 10,
          paddingTop: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: renderHomeTabIcon,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: renderSettingsTabIcon,
        }}
      />
    </Tabs>
  );
}