import { ROLE_LABELS } from '@istakip/shared';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Message, colors, s } from '@/components/ui';
import { currentPushToken, disablePush, enablePush, pushSupport } from '@/lib/push';
import { useCompany } from '@/lib/company';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const c = useCompany();
  const { session } = useSession();
  const me = c.members.find((m) => m.user_id === c.userId);
  const support = pushSupport();
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => {
    void currentPushToken().then((t) => setPushOn(Boolean(t)));
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setPushMsg(null);
    if (pushOn) {
      await disablePush();
      setPushOn(false);
      setPushMsg({ kind: 'success', text: 'Bu cihaza push bildirimi gönderilmeyecek.' });
    } else {
      const r = await enablePush();
      setPushOn(r.ok);
      setPushMsg(r.ok ? { kind: 'success', text: 'Push bildirimleri bu cihazda açık.' } : { kind: 'error', text: r.error });
    }
    setPushBusy(false);
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card title="Hesap">
        <Text style={[s.body, { fontWeight: '700' }]}>{me?.profile.full_name || '—'}</Text>
        <Text style={s.muted}>{session?.user.email}</Text>
        {c.active ? <Text style={s.body}>Rol: {ROLE_LABELS[c.active.role]}</Text> : null}
      </Card>
      {c.memberships.length > 1 ? (
        <Card title="Şirket">
          {c.memberships.map((m) => {
            const active = m.company_id === c.companyId;
            return (
              <Pressable
                key={m.company_id}
                accessibilityRole="radio"
                aria-checked={active}
                onPress={() => c.setActive(m.company_id)}
                style={{ minHeight: 48, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.line }}
              >
                <Text style={[s.body, active ? { fontWeight: '700', color: colors.brand } : null]}>
                  {active ? '● ' : '○ '}
                  {m.company.name}
                </Text>
              </Pressable>
            );
          })}
        </Card>
      ) : null}
      <Card title="Push bildirimleri">
        <Text style={s.muted}>
          Kilit ekranında yalnızca genel bir metin görünür (ör. “Size yeni bir görev verildi”); görev veya mesaj içeriği gösterilmez.
        </Text>
        {support.ok ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            <Text style={[s.body, { fontWeight: '700' }]}>{pushOn ? '✓ Bu cihazda açık' : '○ Bu cihazda kapalı'}</Text>
            <Button title={pushOn ? 'Bu cihazda kapat' : 'Bu cihazda aç'} variant={pushOn ? 'secondary' : 'primary'} busy={pushBusy} onPress={() => void togglePush()} />
          </View>
        ) : (
          <Text style={[s.body, { marginTop: 8 }]}>Kullanılamıyor: {support.reason}</Text>
        )}
        {pushMsg ? <Message kind={pushMsg.kind} text={pushMsg.text} /> : null}
      </Card>
      <View>
        <Button
          title="Çıkış yap"
          variant="danger"
          onPress={() => {
            // Önce bu cihazın push kaydı kapatılır (çıkıştan sonra bu kişiye push gitmez)
            void disablePush().finally(() => void supabase.auth.signOut());
          }}
        />
      </View>
      <Text style={s.muted}>Ekip ve grup yönetimi web panelinden yapılır.</Text>
    </ScrollView>
  );
}
