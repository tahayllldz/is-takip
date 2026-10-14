import Ionicons from '@expo/vector-icons/Ionicons';
import { countUnreadNotifications, fetchConversationList, toAppError } from '@istakip/shared';
import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { ScrollView, Text, View, useWindowDimensions, type ColorValue } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorView, Icon, Loading, type IconName } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { keys } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/lib/theme';

/** Seçili sekmede dolu, diğerlerinde çizgi simge (yalnızca renkle değil, biçimle de ayrılır) */
const icon =
  (filled: IconName, outline: IconName) =>
  ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Ionicons name={focused ? filled : outline} size={24} color={color as string} accessibilityElementsHidden importantForAccessibility="no" />
  );

export default function TabsLayout() {
  const c = useCompany();
  const { t, s } = useTheme();
  // Çok dar ekranlarda (<360 pt) beş sekme etiketi sığsın diye biraz küçülür (simge ve erişilebilirlik etiketi tam adı verir)
  const { width } = useWindowDimensions();
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

  if (c.loading) return <Loading label="Şirket bilgileri yükleniyor…" />;
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
        <ScrollView contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: 'center' }]}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.selection.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="business-outline" size={32} color={t.selection.fg} />
          </View>
          <Text style={s.title} accessibilityRole="header">
            Henüz bir şirkete üye değilsiniz
          </Text>
          <Text style={s.body}>Yöneticinizden davet bağlantısı isteyin. Daveti kabul ettikten sonra bu ekranı yenileyin.</Text>
          <View style={{ gap: space.md }}>
            <Button title="Yenile" icon="refresh" variant="secondary" onPress={c.refetch} />
            <Button title="Çıkış yap" icon="log-out-outline" variant="danger" onPress={() => void supabase.auth.signOut()} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const tasksOn = c.enabledModules.includes('tasks');
  const unread = unreadQ.data ?? 0;
  const unreadMessages = messagingOn ? (conversationsQ.data ?? []).reduce((n, x) => n + x.unread_count, 0) : 0;
  const badgeStyle = { backgroundColor: t.badge.countBg, color: t.badge.countFg, fontWeight: '700' as const, fontSize: 12 };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.navigation.tabActive,
        tabBarInactiveTintColor: t.navigation.tabInactive,
        tabBarLabelStyle: { fontSize: width < 360 ? 11 : 13, fontWeight: '600' },
        tabBarStyle: { minHeight: 64, paddingTop: space.xs, backgroundColor: t.navigation.tabBg, borderTopColor: t.navigation.tabBorder },
        tabBarBadgeStyle: badgeStyle,
        headerStyle: { backgroundColor: t.navigation.headerBg },
        headerTitleStyle: { fontWeight: '700', fontSize: 18, color: t.navigation.headerFg },
        headerTintColor: t.navigation.headerTint,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: t.surface.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Bugün', tabBarIcon: icon('today', 'today-outline'), tabBarAccessibilityLabel: 'Bugün' }} />
      <Tabs.Screen
        name="gorevler"
        options={{
          title: 'Görevler',
          tabBarIcon: icon('checkbox', 'checkbox-outline'),
          href: tasksOn ? undefined : null,
          tabBarAccessibilityLabel: 'Görevler',
        }}
      />
      <Tabs.Screen
        name="mesajlar"
        options={{
          title: 'Mesajlar',
          tabBarIcon: icon('chatbubbles', 'chatbubbles-outline'),
          href: messagingOn ? undefined : null,
          tabBarBadge: unreadMessages > 0 ? (unreadMessages > 99 ? '99+' : unreadMessages) : undefined,
          tabBarAccessibilityLabel: unreadMessages ? `Mesajlar, ${unreadMessages} okunmamış` : 'Mesajlar',
        }}
      />
      <Tabs.Screen
        name="bildirimler"
        options={{
          title: 'Bildirimler',
          tabBarIcon: icon('notifications', 'notifications-outline'),
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarAccessibilityLabel: unread ? `Bildirimler, ${unread} okunmamış` : 'Bildirimler',
        }}
      />
      <Tabs.Screen name="profil" options={{ title: 'Profil', tabBarIcon: icon('person-circle', 'person-circle-outline'), tabBarAccessibilityLabel: 'Profil' }} />
    </Tabs>
  );
}
