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
    body: 'text-slate-300',
    card: 'border-slate-800 bg-slate-900',
    hero: 'border border-slate-800 bg-[#12231f]',
    kicker: 'text-emerald-300',
    sceneBackground: '#08120f',
    screen: 'bg-[#08120f]',
    segmentActive: 'bg-emerald-400',
    segmentActiveText: 'text-slate-950',
    segmentInactiveText: 'text-slate-300',
    segmentTrack: 'bg-slate-800',
    tabBarActiveTint: '#6ee7b7',
    tabBarBackground: '#0f1720',
    tabBarBorder: '#1f2a37',
    tabBarInactiveTint: '#94a3b8',
    title: 'text-slate-50',
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
      background: '#08120f',
      border: '#1f2a37',
      card: '#0f1720',
      notification: '#6ee7b7',
      primary: '#6ee7b7',
      text: '#f8fafc',
    },
  },
};