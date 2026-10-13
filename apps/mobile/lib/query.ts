/**
 * Veri önbelleği ve tutarlılık:
 * - Uygulama ön plana gelince (AppState) sorgular yenilenir.
 * - İnternet geri gelince (expo-network) sorgular yenilenir.
 * - Realtime olayları yalnızca "yenile" sinyalidir; veri her zaman RLS'li sorguyla gelir.
 */
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 2, refetchOnReconnect: true, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
  onlineManager.setEventListener((setOnline) => {
    const sub = Network.addNetworkStateListener((state) => setOnline(Boolean(state.isConnected)));
    return () => sub.remove();
  });
}

export const keys = {
  memberships: (uid: string) => ['memberships', uid] as const,
  company: (cid: string) => ['company', cid] as const,
  tasks: (cid: string, scope: string, status: string) => ['tasks', cid, scope, status] as const,
  task: (id: string) => ['task', id] as const,
  notifications: (cid: string) => ['notifications', cid] as const,
  unread: (cid: string) => ['unread', cid] as const,
};
