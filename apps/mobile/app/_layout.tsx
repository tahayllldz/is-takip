import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Loading, colors, s } from '@/components/ui';
import { CompanyProvider } from '@/lib/company';
import { queryClient } from '@/lib/query';
import { SessionProvider, useSession } from '@/lib/session';
import { isConfigured } from '@/lib/supabase';

function SetupScreen() {
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.h1} accessibilityRole="header">
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

function Gate() {
  const { session, loading } = useSession();
  if (!isConfigured) return <SetupScreen />;
  if (loading) {
    return (
      <View style={s.screen}>
        <Loading label="Oturum kontrol ediliyor…" />
      </View>
    );
  }
  return (
    <CompanyProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { fontWeight: '700', color: colors.ink },
          headerTintColor: colors.brand,
          contentStyle: { backgroundColor: colors.canvas },
          headerBackTitle: 'Geri',
        }}
      >
        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="gorev/[id]" options={{ title: 'Görev' }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="giris" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </CompanyProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <Gate />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
