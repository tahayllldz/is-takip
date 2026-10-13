import { loginSchema, fieldErrors, toAppError } from '@istakip/shared';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Message, colors, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    const { error: e } = await supabase.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (e) {
      if (e.status === 400 || e.status === 401) setError('E-posta veya şifre hatalı.');
      else setError(toAppError(e).message);
    }
    // Başarılıysa oturum değişir ve yönlendirme otomatik olur.
  }

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.brand, textAlign: 'center' }}>İş Takip</Text>
          <View style={s.card}>
            <Text style={[s.h1, { marginBottom: 12 }]} accessibilityRole="header">
              Giriş yap
            </Text>
            <Field
              label="E-posta"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              error={errors.email}
            />
            <Field
              label="Şifre"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              error={errors.password}
              onSubmitEditing={submit}
            />
            {error ? <Message kind="error" text={error} /> : null}
            <View style={{ marginTop: 12 }}>
              <Button title="Giriş yap" onPress={submit} busy={busy} />
            </View>
          </View>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            Hesabınız yoksa yöneticinizden davet bağlantısı isteyin. Daveti kabul edip şifrenizi belirledikten sonra buradan giriş
            yapabilirsiniz.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
