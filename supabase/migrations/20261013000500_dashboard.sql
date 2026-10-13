-- =====================================================================
-- DÜZENLENEBİLİR ANA SAYFA (core)
-- Bileşen kaydı + şirket/rol varsayılanları + kişisel düzen (web ve mobil ayrı).
-- Çözüm sırası (packages/shared/src/dashboard.ts): kişisel → rol varsayılanı → yerleşik.
-- Düzen yalnızca neyin hangi sırada GÖRÜNECEĞİNİ belirler; erişimi değiştirmez:
--   * yetki gerektiren bileşen (ör. ekip özeti) yetkisi olmayan kişinin düzenine eklenemez,
--   * bileşenin verisi her durumda RLS'li sorguyla gelir,
--   * kapalı modülün bileşeni kayıtlı düzende kalır ama gösterilmez (modül açılınca geri gelir).
-- =====================================================================

create table public.dashboard_widgets (
  id text primary key,
  module_id text not null references public.modules (id),
  requires_perm text references public.permissions (key),
  title text not null,
  sort_order integer not null default 0
);

insert into public.dashboard_widgets (id, module_id, requires_perm, title, sort_order) values
  ('my_today',             'tasks',         null,             'Bugünkü işlerim',          10),
  ('overdue',              'tasks',         null,             'Geciken işler',            20),
  ('assigned_by_me',       'tasks',         null,             'Verdiğim işler',           30),
  ('mentions',             'messaging',     null,             'Etiketlendiğim mesajlar',  40),
  ('awaiting_my_approval', 'task_approval', null,             'Onayımı bekleyenler',      50),
  ('team_summary',         'tasks',         'tasks.view_all', 'Ekip görev özeti',         60);

create type public.dashboard_platform as enum ('web', 'mobile');

create table public.dashboard_role_defaults (
  company_id uuid not null references public.companies (id) on delete cascade,
  role public.member_role not null,
  platform public.dashboard_platform not null,
  widgets text[] not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (company_id, role, platform)
);

create table public.dashboard_user_layouts (
  company_id uuid not null,
  user_id uuid not null,
  platform public.dashboard_platform not null,
  widgets text[] not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id, platform),
  foreign key (company_id, user_id) references public.company_members (company_id, user_id) on delete cascade
);

-- =====================================================================
-- Yardımcılar
-- =====================================================================

-- Bileşen listesi: bilinen kimlikler, tekrarsız (ilk görülen sıra korunur), en fazla 12.
create function private.normalize_widgets(p_widgets text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text[] := '{}';
  w text;
begin
  if p_widgets is null then
    perform private.fail('invalid', 'Bileşen listesi eksik.');
  end if;
  if cardinality(p_widgets) > 12 then
    perform private.fail('invalid', 'Ana sayfada en fazla 12 bileşen olabilir.');
  end if;
  foreach w in array p_widgets loop
    if not exists (select 1 from public.dashboard_widgets d where d.id = w) then
      perform private.fail('invalid', 'Bilinmeyen ana sayfa bileşeni: ' || coalesce(w, '?'));
    end if;
    if not (w = any (v)) then
      v := array_append(v, w);
    end if;
  end loop;
  return v;
end;
$$;

-- Kişi bu bileşeni düzenine ekleyebilir mi (izin; modül durumu değil — kapalı modülün bileşeni saklanır, gösterilmez)
create function private.user_can_use_widget(p_user uuid, p_company uuid, p_widget text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select d.requires_perm is null
         or private.user_has_perm(p_user, p_company, d.requires_perm, null)
         or exists (
           select 1 from public.member_scope_groups s
           where s.company_id = p_company and s.user_id = p_user
             and private.user_has_perm(p_user, p_company, d.requires_perm, s.group_id)
         )
     from public.dashboard_widgets d where d.id = p_widget),
    false
  );
$$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.dashboard_widgets enable row level security;
alter table public.dashboard_role_defaults enable row level security;
alter table public.dashboard_user_layouts enable row level security;

create policy dashboard_widgets_read on public.dashboard_widgets for select to authenticated using (true);

create policy dashboard_role_defaults_read on public.dashboard_role_defaults for select to authenticated
using (private.is_member(company_id));

create policy dashboard_user_layouts_read on public.dashboard_user_layouts for select to authenticated
using (user_id = (select auth.uid()) and private.is_member(company_id));

-- =====================================================================
-- RPC fonksiyonları
-- =====================================================================
create function public.save_my_dashboard(p_company uuid, p_platform public.dashboard_platform, p_widgets text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v text[];
  w text;
begin
  perform private.require_member(p_company);
  v := private.normalize_widgets(p_widgets);
  foreach w in array v loop
    if not private.user_can_use_widget(v_uid, p_company, w) then
      perform private.fail('forbidden', 'Bu bileşeni ekleme yetkiniz yok: '
        || (select d.title from public.dashboard_widgets d where d.id = w));
    end if;
  end loop;
  insert into public.dashboard_user_layouts (company_id, user_id, platform, widgets, updated_at)
  values (p_company, v_uid, p_platform, v, now())
  on conflict (company_id, user_id, platform) do update set widgets = excluded.widgets, updated_at = excluded.updated_at;
  return v;
end;
$$;

create function public.reset_my_dashboard(p_company uuid, p_platform public.dashboard_platform)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_company);
  delete from public.dashboard_user_layouts
  where company_id = p_company and user_id = private.require_uid() and platform = p_platform;
end;
$$;

-- Şirket/rol varsayılanı (dashboard.manage_defaults). Rolün göremeyeceği bileşen eklenemez.
create function public.save_dashboard_default(
  p_company uuid,
  p_role public.member_role,
  p_platform public.dashboard_platform,
  p_widgets text[]
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text[];
  w text;
  v_perm text;
begin
  perform private.require_member(p_company);
  perform private.require_perm(p_company, 'dashboard.manage_defaults');
  v := private.normalize_widgets(p_widgets);
  foreach w in array v loop
    select d.requires_perm into v_perm from public.dashboard_widgets d where d.id = w;
    if v_perm is not null and p_role <> 'owner'
       and not exists (select 1 from public.role_permissions rp where rp.role = p_role and rp.permission = v_perm) then
      perform private.fail('invalid', 'Bu roldeki kişiler şu bileşeni göremez: '
        || (select d.title from public.dashboard_widgets d where d.id = w));
    end if;
  end loop;
  insert into public.dashboard_role_defaults (company_id, role, platform, widgets, updated_at, updated_by)
  values (p_company, p_role, p_platform, v, now(), auth.uid())
  on conflict (company_id, role, platform)
  do update set widgets = excluded.widgets, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform private.audit(p_company, 'dashboard.default_saved', 'company', p_company,
    jsonb_build_object('role', p_role, 'platform', p_platform, 'widgets', to_jsonb(v)));
  return v;
end;
$$;

create function public.reset_dashboard_default(p_company uuid, p_role public.member_role, p_platform public.dashboard_platform)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_company);
  perform private.require_perm(p_company, 'dashboard.manage_defaults');
  delete from public.dashboard_role_defaults where company_id = p_company and role = p_role and platform = p_platform;
  if found then
    perform private.audit(p_company, 'dashboard.default_reset', 'company', p_company,
      jsonb_build_object('role', p_role, 'platform', p_platform));
  end if;
end;
$$;

select private.apply_api_grants();
