import type { ExpoConfig } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';

const config: ExpoConfig = {
  name: IS_DEV ? 'When Did I Last (Dev)' : 'When Did I Last',
  slug: 'when-did-i-last',
  scheme: IS_DEV ? 'whendidilast-dev' : 'whendidilast',
  version: '1.0.0',
  newArchEnabled: false,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/when-did-i-last-splash-top.png',
    resizeMode: 'contain',
    backgroundColor: '#F5EFB9',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: IS_DEV
      ? 'com.benedikt.weyer.whendidilast.dev'
      : 'com.benedikt.weyer.whendidilast',
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#F5EFB9',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    package: IS_DEV
      ? 'com.benedikt.weyer.whendidilast.dev'
      : 'com.benedikt.weyer.whendidilast',
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: ['expo-router', 'expo-secure-store', 'expo-sqlite'],
};

export default config;
