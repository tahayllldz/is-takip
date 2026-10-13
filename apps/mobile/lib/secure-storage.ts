/**
 * Oturum belirteçleri telefonda şifreli saklanır (iOS Keychain / Android Keystore,
 * expo-secure-store). SecureStore değer boyutu sınırlı olduğu için değer parçalara
 * bölünür. Web önizlemesinde (yalnızca geliştirme) AsyncStorage/localStorage kullanılır.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK = 1800;
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

const secureChunkStorage = {
  async getItem(key: string): Promise<string | null> {
    const k = safeKey(key);
    const count = await SecureStore.getItemAsync(`${k}__n`);
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < Number(count); i++) {
      const p = await SecureStore.getItemAsync(`${k}__${i}`);
      if (p === null) return null;
      parts.push(p);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const k = safeKey(key);
    const old = Number((await SecureStore.getItemAsync(`${k}__n`)) ?? 0);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(`${k}__${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    for (let i = n; i < old; i++) await SecureStore.deleteItemAsync(`${k}__${i}`);
    await SecureStore.setItemAsync(`${k}__n`, String(n));
  },
  async removeItem(key: string): Promise<void> {
    const k = safeKey(key);
    const n = Number((await SecureStore.getItemAsync(`${k}__n`)) ?? 0);
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${k}__${i}`);
    await SecureStore.deleteItemAsync(`${k}__n`);
  },
};

export const authStorage = Platform.OS === 'web' ? AsyncStorage : secureChunkStorage;

/** Hassas olmayan tercihler (ör. seçili şirket) */
export const prefs = AsyncStorage;
