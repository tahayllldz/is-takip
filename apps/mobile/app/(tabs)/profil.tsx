import { ROLE_LABELS } from '@istakip/shared';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, colors, s } from '@/components/ui';
import { useCompany } from '@/lib/company';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const c = useCompany();
  const { session } = useSession();
  const me = c.members.find((m) => m.user_id === c.userId);
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
      <View>
        <Button title="Çıkış yap" variant="danger" onPress={() => void supabase.auth.signOut()} />
      </View>
      <Text style={s.muted}>Ekip ve grup yönetimi web panelinden yapılır.</Text>
    </ScrollView>
  );
}
