import { loginSchema, fieldErrors, toAppError } from '@istakip/shared';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Icon, Message } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { radius, space, useTheme } from '@/lib/theme';

/**
 * Giriş. Şirket henüz bilinmediği için burada şirket teması uygulanmaz (uygulamanın kendi teması);
 * bir cihazda önceki şirketin logosu/renkleri gösterilmez.
 */
export default function LoginScreen() {
  const { t, s } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

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
        <ScrollView
          contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: 'center', maxWidth: 480, width: '100%', alignSelf: 'center' }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
            <View
              style={{ width: 64, height: 64, borderRadius: radius.lg, backgroundColor: t.action.primary.bg, alignItems: 'center', justifyContent: 'center' }}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              <Icon name="checkmark-done" size={34} color={t.action.primary.fg} />
            </View>
            <Text style={s.title} accessibilityRole="header">
              İş Takip
            </Text>
            <Text style={[s.muted, { textAlign: 'center' }]}>Ekibinizin görevleri ve mesajları tek yerde.</Text>
          </View>

          <View style={[s.card, { padding: space.xl }]}>
            <Text style={[s.heading, { marginBottom: space.lg }]}>Giriş yap</Text>
            <Field
              label="E-posta"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              error={errors.email}
            />
            <Field
              ref={passwordRef}
              label="Şifre"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!show}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              error={errors.password}
              onSubmitEditing={() => void submit()}
              right={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={show ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  onPress={() => setShow((v) => !v)}
                  style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name={show ? 'eye-off-outline' : 'eye-outline'} size={22} />
                </Pressable>
              }
            />
            {error ? <Message kind="error" text={error} /> : null}
            <View style={{ marginTop: space.md }}>
              <Button title="Giriş yap" icon="log-in-outline" onPress={() => void submit()} busy={busy} />
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xs }}>
            <Icon name="mail-unread-outline" size={20} />
            <Text style={[s.muted, { flex: 1 }]}>
              Hesabınız yoksa yöneticinizden davet bağlantısı isteyin. Daveti kabul edip şifrenizi belirledikten sonra buradan giriş
              yapabilirsiniz.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
