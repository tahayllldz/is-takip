import { ROLE_LABELS } from '@istakip/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { confirmAction } from '@/lib/confirm';
import { BrandLogo } from '@/components/brand-logo';
import { Avatar, Badge, Button, Card, Icon, ListRow, Message } from '@/components/ui';
import { currentPushToken, disablePush, enablePush, pushSupport } from '@/lib/push';
import { useCompany } from '@/lib/company';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { space, useTheme } from '@/lib/theme';

export default function ProfileScreen() {
  const c = useCompany();
  const { t, s } = useTheme();
  const { session } = useSession();
  const me = c.members.find((m) => m.user_id === c.userId);
  const support = pushSupport();
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  useEffect(() => {
    void currentPushToken().then((tok) => setPushOn(Boolean(tok)));
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

  async function signOut() {
    const ok = await confirmAction({
      title: 'Çıkış yapılsın mı?',
      message: 'Bu cihazda oturumunuz kapanır ve bu cihaza push bildirimi gönderilmez.',
      confirm: 'Çıkış yap',
      destructive: true,
    });
    // Önce bu cihazın push kaydı kapatılır (çıkıştan sonra bu kişiye push gitmez)
    if (ok) void disablePush().finally(() => void supabase.auth.signOut());
  }

  const name = me?.profile.full_name || session?.user.email || '—';
  const canBrand = c.can('branding.manage');

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: space.lg }]}>
        <Avatar name={name} size={56} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Text style={s.heading} accessibilityRole="header">
            {name}
          </Text>
          <Text style={s.muted} numberOfLines={1}>
            {session?.user.email}
          </Text>
          {c.active ? <Badge t="info" icon="shield-checkmark-outline" label={ROLE_LABELS[c.active.role]} /> : null}
        </View>
      </View>

      <Card title="Şirket" icon="business-outline">
        {c.active ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingBottom: space.md }}>
            <BrandLogo name={c.active.company.name} height={40} maxWidth={120} />
            <Text style={[s.strong, { flex: 1 }]}>{c.active.company.name}</Text>
          </View>
        ) : null}
        {c.memberships.length > 1 ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="Etkin şirket" style={{ borderTopWidth: 1, borderTopColor: t.border.default }}>
            <Text style={[s.caption, { paddingTop: space.md }]}>Şirket değiştir</Text>
            {c.memberships.map((m) => {
              const active = m.company_id === c.companyId;
              return (
                <Pressable
                  key={m.company_id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => c.setActive(m.company_id)}
                  style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: pressed ? 0.7 : 1 })}
                >
                  <Icon name={active ? 'radio-button-on' : 'radio-button-off'} size={22} color={active ? t.selection.fg : t.text.secondary} />
                  <Text style={[s.body, active ? { fontWeight: '700', color: t.selection.fg } : null]}>{m.company.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {canBrand ? (
          <View style={{ borderTopWidth: 1, borderTopColor: t.border.default }}>
            <ListRow
              icon="color-palette-outline"
              title="Marka ve görünüm"
              subtitle="Logo, renkler ve uygulamada nerede kullanılacağı"
              onPress={() => router.push('/marka')}
              last
            />
          </View>
        ) : null}
      </Card>

      <Card title="Push bildirimleri" icon="notifications-outline">
        <Text style={s.muted}>
          Kilit ekranında yalnızca genel bir metin görünür (ör. “Size yeni bir görev verildi”); görev veya mesaj içeriği gösterilmez.
        </Text>
        {support.ok ? (
          <View style={{ marginTop: space.md, gap: space.md }}>
            <Badge t={pushOn ? 'success' : 'neutral'} icon={pushOn ? 'checkmark' : 'ellipse-outline'} label={pushOn ? 'Bu cihazda açık' : 'Bu cihazda kapalı'} />
            <Button title={pushOn ? 'Bu cihazda kapat' : 'Bu cihazda aç'} variant={pushOn ? 'secondary' : 'primary'} busy={pushBusy} onPress={() => void togglePush()} />
          </View>
        ) : (
          <View style={{ marginTop: space.md, flexDirection: 'row', gap: space.sm }}>
            <Icon name="information-circle-outline" size={20} />
            <Text style={[s.body, { flex: 1 }]}>Kullanılamıyor: {support.reason}</Text>
          </View>
        )}
        {pushMsg ? (
          <View style={{ marginTop: space.md }}>
            <Message kind={pushMsg.kind} text={pushMsg.text} />
          </View>
        ) : null}
      </Card>

      <View style={{ gap: space.sm, marginTop: space.sm }}>
        <Button title="Çıkış yap" icon="log-out-outline" variant="danger" onPress={() => void signOut()} />
        <Text style={[s.muted, { textAlign: 'center' }]}>Ekip, grup ve görev atama yönetimi web panelinden yapılır.</Text>
      </View>
    </ScrollView>
  );
}
