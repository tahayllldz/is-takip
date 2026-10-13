/**
 * Push bildirimleri (mobil).
 * - Expo Go push'u desteklemez; uygulamanın geliştirme/mağaza derlemesi ve EAS proje kimliği gerekir.
 *   Desteklenmeyen ortamda sahte bir "açık" durumu gösterilmez; nedeni açıkça yazılır.
 * - Kilit ekranında içerik yok: sunucu yalnızca genel metin gönderir; Android kanalı da "özel" görünürlüktedir.
 * - Bildirime dokununca ilgili görev/sohbet açılır (veri yalnızca kimlik içerir; ayrıntı RLS ile çekilir).
 */
import { registerPushDevice, unregisterPushDevice, type PushData } from '@istakip/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { prefs } from './secure-storage';
import { supabase } from './supabase';

const TOKEN_KEY = 'istakip.pushToken';

const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;

export type PushSupport = { ok: true } | { ok: false; reason: string };

export function pushSupport(): PushSupport {
  if (Platform.OS === 'web') return { ok: false, reason: 'Web önizlemesinde push bildirimi yoktur.' };
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return { ok: false, reason: 'Expo Go push bildirimini desteklemiyor. Uygulamanın geliştirme veya mağaza sürümü gerekir.' };
  }
  if (!Device.isDevice) return { ok: false, reason: 'Push bildirimi yalnızca gerçek telefonda çalışır (simülatörde değil).' };
  if (!projectId()) return { ok: false, reason: 'EAS proje kimliği tanımlı değil (app.json → extra.eas.projectId; `eas init`).' };
  return { ok: true };
}

if (Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
  // Uygulama açıkken gelen bildirim de gösterilir (içerik zaten genel)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function currentPushToken(): Promise<string | null> {
  return prefs.getItem(TOKEN_KEY).catch(() => null);
}

/** İzin ister, Expo token'ı alır ve kullanıcının kendi oturumuyla kaydeder. */
export async function enablePush(): Promise<{ ok: true } | { ok: false; error: string }> {
  const support = pushSupport();
  if (!support.ok) return { ok: false, error: support.reason };
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Bildirimler',
        importance: Notifications.AndroidImportance.HIGH,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return { ok: false, error: 'Bildirim izni verilmedi. Telefon ayarlarından İş Takip için bildirimleri açabilirsiniz.' };
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
    await registerPushDevice(supabase, token, Platform.OS === 'ios' ? 'ios' : 'android', Device.deviceName ?? Device.modelName ?? null);
    await prefs.setItem(TOKEN_KEY, token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Push bildirimi açılamadı.' };
  }
}

/** Çıkışta veya kullanıcı kapatınca: bu cihaza artık push gitmez. */
export async function disablePush(): Promise<void> {
  const token = await currentPushToken();
  if (!token) return;
  await unregisterPushDevice(supabase, token).catch(() => undefined);
  await prefs.removeItem(TOKEN_KEY).catch(() => undefined);
}

function openFromPush(data: Partial<PushData> | undefined) {
  if (!data) return;
  if (data.entityType === 'task' && data.entityId) router.push(`/gorev/${data.entityId}`);
  else if (data.entityType === 'message' && data.conversationId) {
    router.push({ pathname: '/mesaj/[id]', params: { id: data.conversationId, ...(data.entityId ? { m: data.entityId } : {}) } });
  } else router.push('/bildirimler');
}

/** Bildirime dokunulunca (uygulama açıkken veya kapalıyken) ilgili ekrana gider. */
export function usePushNavigation(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !pushSupport().ok) return;
    let handled: string | null = null;
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r && r.notification.request.identifier !== handled) {
        handled = r.notification.request.identifier;
        openFromPush(r.notification.request.content.data as Partial<PushData>);
      }
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      if (r.notification.request.identifier === handled) return;
      handled = r.notification.request.identifier;
      openFromPush(r.notification.request.content.data as Partial<PushData>);
    });
    return () => sub.remove();
  }, [enabled]);
}
