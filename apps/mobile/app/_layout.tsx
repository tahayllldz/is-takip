import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Icon, Loading } from '@/components/ui';
import { CompanyProvider, useCompany } from '@/lib/company';
import { queryClient } from '@/lib/query';
import { SessionProvider, useSession } from '@/lib/session';
import { usePushNavigation } from '@/lib/push';
import { isConfigured } from '@/lib/supabase';
import { ThemeProvider, space, useTheme } from '@/lib/theme';

function SetupScreen() {
  const { t, s } = useTheme();
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: 'center' }]}>
        <Icon name="server-outline" size={40} color={t.text.link} />
        <Text style={s.title} accessibilityRole="header">
          Sunucu bağlantısı tanımlı değil
        </Text>
        <Text style={s.body}>
          Uygulama gerçek bir Supabase sunucusu olmadan çalışmaz; sahte veri gösterilmez. apps/mobile/.env dosyasına
          EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY değerlerini yazıp uygulamayı yeniden başlatın.
        </Text>
        <Text style={s.muted}>Telefonda test ederken adres olarak bilgisayarın yerel ağ IP'sini kullanın.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Aktif şirketin teması (şirket değişince eski şirketin renkleri kalmaz: anahtar şirket + sürüm) */
function CompanyTheme({ children }: { children: ReactNode }) {
  const c = useCompany();
  const b = c.branding && c.branding.companyId === c.companyId ? c.branding : null;
  return (
    <ThemeProvider branding={b} cacheKey={`${c.companyId ?? '-'}:${b?.version ?? 0}:${b?.updatedAt ?? ''}`}>
      {children}
    </ThemeProvider>
  );
}

function AppStack() {
  const { session } = useSession();
  const { t } = useTheme();
  return (
    <>
      <StatusBar style={t.navigation.statusBar} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.navigation.headerBg },
          headerTitleStyle: { fontWeight: '700', color: t.navigation.headerFg },
          headerTintColor: t.navigation.headerTint,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.surface.canvas },
          headerBackTitle: 'Geri',
        }}
      >
        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="gorev/[id]" options={{ title: 'Görev' }} />
          <Stack.Screen name="mesaj/[id]" options={{ title: 'Sohbet' }} />
          <Stack.Screen name="marka" options={{ title: 'Marka ve görünüm' }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="giris" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function Gate() {
  const { session, loading } = useSession();
  const { s } = useTheme();
  usePushNavigation(Boolean(session));
  if (!isConfigured) return <SetupScreen />;
  if (loading) {
    return (
      <View style={[s.screen, { padding: space.lg }]}>
        <Loading label="Oturum kontrol ediliyor…" />
      </View>
    );
  }
  return (
    <CompanyProvider>
      <CompanyTheme>
        <AppStack />
      </CompanyTheme>
    </CompanyProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
