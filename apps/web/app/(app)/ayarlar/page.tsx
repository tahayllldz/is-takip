import {
  BUILTIN_DASHBOARDS,
  DASHBOARD_PLATFORMS,
  DASHBOARD_PLATFORM_LABELS,
  GROUP_MANAGER_PERMISSIONS,
  MODULES,
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  WIDGETS,
  addableWidgets,
  fetchDashboardRoleDefaults,
  fetchModuleStates,
  resolveDashboard,
  type DashboardPlatform,
  type ModuleId,
  type Role,
  type WidgetDef,
} from '@istakip/shared';
import Link from 'next/link';
import { DashboardEditor } from '@/components/dashboard-editor';
import { CompanyForm, ModuleToggle } from '@/components/settings-forms';
import { Badge, Card, PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'Ayarlar' };

const yes = (
  <span>
    <span aria-hidden="true">✓</span>
    <span className="sr-only">Var</span>
  </span>
);
const no = (
  <span className="text-muted">
    <span aria-hidden="true">—</span>
    <span className="sr-only">Yok</span>
  </span>
);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ varsayilan?: string }> }) {
  const [s, sp] = await Promise.all([requireSession(), searchParams]);
  const states = s.can('modules.manage') ? await fetchModuleStates(s.supabase, s.companyId) : [];
  const has = (role: 'owner' | 'admin' | 'employee', key: string) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(key);

  return (
    <>
      <PageHeader title="Ayarlar" />
      <div className="space-y-6">
        {s.can('company.manage') ? (
          <Card title="Şirket">
            <CompanyForm name={s.active.company.name} timezone={s.timezone} />
          </Card>
        ) : null}

        {s.can('modules.manage') ? (
          <Card title="Modüller">
            <p className="mb-3 text-muted">
              Kapatılan modülün menüleri ve ana sayfa bileşenleri kalkar; yeni işlem ve bildirim sunucuda engellenir. Veriler
              silinmez: şirket sahibi ve tüm şirket yetkili yöneticiler kayıtları salt okunur görebilir. Yeniden açınca kaldığı
              yerden devam edilir.
            </p>
            <ul className="divide-y divide-line">
              {(Object.keys(MODULES) as ModuleId[])
                .filter((id) => !MODULES[id].core)
                .map((id) => {
                  const st = states.find((x) => x.module_id === id);
                  const def = MODULES[id];
                  return (
                    <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-semibold">
                          {def.name}{' '}
                          {st ? (
                            st.enabled ? (
                              <Badge tone="success" symbol="●">Açık</Badge>
                            ) : (
                              <Badge tone="neutral" symbol="○">Kapalı</Badge>
                            )
                          ) : (
                            <Badge tone="neutral">Yakında</Badge>
                          )}
                        </p>
                        <p className="text-[0.9375rem] text-muted">{def.description}</p>
                        {def.dependsOn.length ? (
                          <p className="text-[0.9375rem] text-muted">Gerektirir: {def.dependsOn.map((d) => MODULES[d].name).join(', ')}</p>
                        ) : null}
                      </div>
                      {st ? <ModuleToggle module={id} enabled={st.enabled} label={def.name} /> : null}
                    </li>
                  );
                })}
            </ul>
          </Card>
        ) : null}

        <Card title="Yetki tablosu">
          <p className="mb-3 text-muted">
            Yönetici yetkisi “Tüm şirket” ya da “Yalnızca seçili gruplar” kapsamında verilebilir. Kısıtlı yönetici, “grupla
            sınırlanabilir” izinleri yalnızca kapsamındaki gruplarda kullanır; şirket geneli izinler için çalışan haklarına sahiptir.
            Grup yöneticisi kendi grubunu düzenler.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <caption className="sr-only">Rollere göre izinler</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-3">İzin</th>
                  <th scope="col" className="px-3 py-2">Kapsam</th>
                  <th scope="col" className="px-3 py-2">Sahip</th>
                  <th scope="col" className="px-3 py-2">Yönetici</th>
                  <th scope="col" className="px-3 py-2">Çalışan</th>
                  <th scope="col" className="px-3 py-2">Grup yöneticisi</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((p) => (
                  <tr key={p.key} className="border-b border-line">
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {p.label}
                      <span className="block text-sm text-muted">{MODULES[p.module].name}</span>
                    </th>
                    <td className="px-3 py-2 text-[0.9375rem]">{p.scope === 'group' ? 'Grupla sınırlanabilir' : 'Şirket geneli'}</td>
                    <td className="px-3 py-2">{has('owner', p.key) ? yes : no}</td>
                    <td className="px-3 py-2">{has('admin', p.key) ? yes : no}</td>
                    <td className="px-3 py-2">{has('employee', p.key) ? yes : no}</td>
                    <td className="px-3 py-2">{GROUP_MANAGER_PERMISSIONS.includes(p.key) ? yes : no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[0.9375rem] text-muted">
            Ek kurallar: rolleri yalnızca şirket sahibi değiştirir; yöneticiyi yalnızca sahip çıkarır; görevin durumunu sorumlu,
            görevi veren veya kapsamında görev yönetim izni olan değiştirir.
          </p>
        </Card>

        {s.can('dashboard.manage_defaults') ? <DashboardDefaults s={s} selected={sp.varsayilan} /> : null}

        {s.can('audit.view') ? (
          <Card title="İşlem geçmişi">
            <p className="mb-3 text-muted">Davet, rol, üyelik, grup ve modül değişikliklerinin kaydı.</p>
            <Link href="/ayarlar/gecmis" className="btn btn-secondary">
              İşlem geçmişini aç
            </Link>
          </Card>
        ) : null}
      </div>
    </>
  );
}

/** Rol ve platform başına varsayılan ana sayfa (kendi düzenini kaydetmemiş kişilere uygulanır). */
async function DashboardDefaults({ s, selected }: { s: Awaited<ReturnType<typeof requireSession>>; selected?: string }) {
  const defaults = await fetchDashboardRoleDefaults(s.supabase, s.companyId);
  const [roleRaw, platformRaw] = (selected ?? 'employee-web').split('-');
  const role: Role = (ROLES as readonly string[]).includes(roleRaw ?? '') ? (roleRaw as Role) : 'employee';
  const platform: DashboardPlatform = (DASHBOARD_PLATFORMS as readonly string[]).includes(platformRaw ?? '') ? (platformRaw as DashboardPlatform) : 'web';
  const current = defaults.find((d) => d.role === role && d.platform === platform);
  // Rolün görebileceği bileşenler: izin gerektirenler yalnızca o role verilmişse
  const roleCanUse = (w: WidgetDef) => !w.requires || role === 'owner' || (ROLE_PERMISSIONS[role] as readonly string[]).includes(w.requires);
  const dash = resolveDashboard({ personal: null, roleDefault: current?.widgets ?? null, role, platform, enabledModules: s.enabledModules, canUse: roleCanUse });
  const item = (id: keyof typeof WIDGETS) => ({ id, title: WIDGETS[id].title, description: WIDGETS[id].description });
  return (
    <Card title="Ana sayfa varsayılanları">
      <p className="mb-3 text-muted">
        Kendi düzenini kaydetmemiş kişiler, rolüne ve kullandığı yere (web/mobil) göre bu düzeni görür. Düzen yalnızca görünümü belirler; kimin
        neyi göreceği yetkilere bağlıdır.
      </p>
      <nav aria-label="Rol ve platform" className="mb-4 flex flex-wrap gap-2">
        {ROLES.flatMap((r) =>
          DASHBOARD_PLATFORMS.map((p) => {
            const key = `${r}-${p}`;
            const active = r === role && p === platform;
            const custom = defaults.some((d) => d.role === r && d.platform === p);
            return (
              <Link
                key={key}
                href={`/ayarlar?varsayilan=${key}#varsayilan`}
                aria-current={active ? 'page' : undefined}
                className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
              >
                {ROLE_LABELS[r]} · {DASHBOARD_PLATFORM_LABELS[p]}
                {custom ? <span className="sr-only"> (şirkete özel)</span> : null}
                {custom ? <span aria-hidden="true"> ●</span> : null}
              </Link>
            );
          }),
        )}
      </nav>
      <div id="varsayilan">
        <DashboardEditor
          key={`${role}-${platform}`}
          mode="default"
          role={role}
          platform={platform}
          source={current ? 'role_default' : 'builtin'}
          initial={dash.widgets.map(item)}
          hidden={dash.hidden}
          available={addableWidgets(dash.widgets, s.enabledModules, roleCanUse).map((w) => item(w.id))}
        />
        <p className="mt-2 text-sm text-muted">
          {current ? `Şirkete özel düzen (${ROLE_LABELS[role]}, ${DASHBOARD_PLATFORM_LABELS[platform]}).` : `Standart düzen kullanılıyor: ${BUILTIN_DASHBOARDS[role][platform].map((id) => WIDGETS[id].title).join(', ')}.`}
        </p>
      </div>
    </Card>
  );
}
