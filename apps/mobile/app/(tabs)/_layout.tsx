import { countUnreadNotifications, fetchConversationList, toAppError } from '@istakip/shared';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { ScrollView, Text, type ColorValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorView, Loading, colors, s } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => (
  <Text style={{ fontSize: 20, color }} accessibilityElementsHidden importantForAccessibility="no">
    {glyph}
  </Text>
);

export default function TabsLayout() {
  const c = useCompany();
  const unreadQ = useQuery({
    queryKey: keys.unread(c.companyId ?? '-'),
    queryFn: () => countUnreadNotifications(supabase, c.companyId!),
    enabled: Boolean(c.companyId),
  });
  const messagingOn = c.enabledModules.includes('messaging');
  const conversationsQ = useQuery({
    queryKey: keys.conversations(c.companyId ?? '-'),
    queryFn: () => fetchConversationList(supabase, c.companyId!),
    enabled: Boolean(c.companyId) && messagingOn,
  });

  if (c.loading) return <Loading />;
  if (c.error) {
    return (
      <SafeAreaView style={[s.screen, s.content]}>
        <ErrorView message={toAppError(c.error).message} onRetry={c.refetch} />
      </SafeAreaView>
    );
  }
  if (!c.active) {
    return (
      <SafeAreaView style={s.screen}>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.h1} accessibilityRole="header">
            Henüz bir şirkete üye değilsiniz
          </Text>
          <Text style={s.body}>Yöneticinizden davet bağlantısı isteyin. Daveti kabul ettikten sonra bu ekranı yenileyin.</Text>
          <Button title="Yenile" variant="secondary" onPress={c.refetch} />
          <Button title="Çıkış yap" variant="danger" onPress={() => void supabase.auth.signOut()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const tasksOn = c.enabledModules.includes('tasks');
  const unread = unreadQ.data ?? 0;
  const unreadMessages = messagingOn ? (conversationsQ.data ?? []).reduce((n, x) => n + x.unread_count, 0) : 0;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        tabBarStyle: { minHeight: 60, paddingBottom: 6 },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontWeight: '700', color: colors.ink },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Bugün', tabBarIcon: icon('☀'), tabBarAccessibilityLabel: 'Bugün' }} />
      <Tabs.Screen
        name="gorevler"
        options={{ title: 'Görevler', tabBarIcon: icon('☑'), href: tasksOn ? undefined : null, tabBarAccessibilityLabel: 'Görevler' }}
      />
      <Tabs.Screen
        name="mesajlar"
        options={{
          title: 'Mesajlar',
          tabBarIcon: icon('💬'),
          href: messagingOn ? undefined : null,
          tabBarBadge: unreadMessages > 0 ? (unreadMessages > 99 ? '99+' : unreadMessages) : undefined,
          tabBarAccessibilityLabel: `Mesajlar, ${unreadMessages} okunmamış`,
        }}
      />
      <Tabs.Screen
        name="bildirimler"
        options={{
          title: 'Bildirimler',
          tabBarIcon: icon('🔔'),
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarAccessibilityLabel: `Bildirimler, ${unread} okunmamış`,
        }}
      />
      <Tabs.Screen name="profil" options={{ title: 'Profil', tabBarIcon: icon('👤'), tabBarAccessibilityLabel: 'Profil' }} />
    </Tabs>
  );
}
