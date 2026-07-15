import {
  DarkTheme,
  DefaultTheme,
  Theme as NavigationTheme,
} from '@react-navigation/native';

import type { ThemeMode } from '../features/theme/theme-storage';

type ThemeTokenSet = {
  body: string;
  card: string;
  hero: string;
  kicker: string;
  sceneBackground: string;
  screen: string;
  segmentActive: string;
  segmentActiveText: string;
  segmentInactiveText: string;
  segmentTrack: string;
  tabBarActiveTint: string;
  tabBarBackground: string;
  tabBarBorder: string;
  tabBarInactiveTint: string;
  title: string;
};

export const themeTokens: Record<ThemeMode, ThemeTokenSet> = {
  light: {
    body: 'text-neutral-700',
    card: 'border-stone-200 bg-white',
    hero: 'border border-[#e6dfac] bg-[#fbf7d7]',
    kicker: 'text-neutral-700',
    sceneBackground: '#F5EFB9',
    screen: 'bg-[#F5EFB9]',
    segmentActive: 'bg-[#47474d]',
    segmentActiveText: 'text-white',
    segmentInactiveText: 'text-neutral-700',
    segmentTrack: 'bg-[#ece5b6]',
    tabBarActiveTint: '#111111',
    tabBarBackground: '#F5EFB9',
    tabBarBorder: '#e1d99d',
    tabBarInactiveTint: '#6b7280',
    title: 'text-neutral-900',
  },
  dark: {
    body: 'text-[#d8d3b8]',
    card: 'border-[#514c39] bg-[#2f2d24]',
    hero: 'border border-[#514c39] bg-[#36321f]',
    kicker: 'text-[#d6cf98]',
    sceneBackground: '#242217',
    screen: 'bg-[#242217]',
    segmentActive: 'bg-[#d6cf98]',
    segmentActiveText: 'text-[#242217]',
    segmentInactiveText: 'text-[#d8d3b8]',
    segmentTrack: 'bg-[#363428]',
    tabBarActiveTint: '#d6cf98',
    tabBarBackground: '#2b291a',
    tabBarBorder: '#514c39',
    tabBarInactiveTint: '#b7b197',
    title: 'text-[#f3efdc]',
  },
};

export const navigationThemes: Record<ThemeMode, NavigationTheme> = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: '#F5EFB9',
      border: '#e1d99d',
      card: '#ffffff',
      notification: '#111111',
      primary: '#111111',
      text: '#171717',
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: '#242217',
      border: '#514c39',
      card: '#2f2d24',
      notification: '#d6cf98',
      primary: '#d6cf98',
      text: '#f3efdc',
    },
  },
};
