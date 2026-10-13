-- =====================================================================
-- ORTAK TEMEL (core modülü)
-- Şirket, kullanıcı profili, şirket üyeliği ve rolleri, kapsamlı yönetici
-- yetkisi, gruplar, izin tablosu, modül kaydı, davetler, bildirim kutusu,
-- işlem geçmişi.
--
-- Güvenlik modeli (docs/ARCHITECTURE.md):
--  * Tüm tablolarda RLS açıktır. İstemci rolü (authenticated) tablolara yalnızca
--    SELECT yetkisine sahiptir; satırları RLS politikaları süzer.
--  * Tüm yazma işlemleri public şemasındaki SECURITY DEFINER RPC fonksiyonlarından
--    geçer. Her fonksiyon üyelik, izin, modül durumu ve şirket sınırını kendisi
--    kontrol eder.
--  * Yetki yardımcıları `private` şemasındadır; bu şema API'ye açık değildir.
--  * Şirketler arası referanslar bileşik yabancı anahtarlarla (company_id, x)
--    veritabanı düzeyinde engellenir.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Türler
-- ---------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'employee');
create type public.member_status as enum ('active', 'removed');
create type public.admin_scope as enum ('company', 'groups');
create type public.group_role as enum ('member', 'manager');

-- ---------------------------------------------------------------------
-- Hata yardımcısı: kullanıcıya gösterilebilir Türkçe mesaj + makine kodu (hint)
-- Kodlar: not_authenticated, forbidden, not_found, invalid, conflict, module_disabled
-- ---------------------------------------------------------------------
create function private.fail(p_code text, p_message text)
returns void
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end;
$$;

create function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    perform private.fail('not_authenticated', 'Oturum açmanız gerekiyor.');
  end if;
  return v;
end;
$$;

create function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Modül kaydı ve izin tablosu
-- ---------------------------------------------------------------------
create table public.modules (
  id text primary key,
  name text not null,
  is_core boolean not null default false,
  depends_on text[] not null default '{}',
  sort_order integer not null default 0
);

create table public.permissions (
  key text primary key,
  module_id text not null references public.modules (id),
  scope text not null check (scope in ('company', 'group')),
  label text not null
);

create table public.role_permissions (
  role public.member_role not null,
  permission text not null references public.permissions (key) on delete cascade,
  primary key (role, permission)
);

create table public.group_role_permissions (
  role public.group_role not null,
  permission text not null references public.permissions (key) on delete cascade,
  primary key (role, permission)
);

insert into public.modules (id, name, is_core, depends_on, sort_order)
values ('core', 'Temel', true, '{}', 0);

insert into public.permissions (key, module_id, scope, label) values
  ('company.manage',            'core', 'company', 'Şirket bilgilerini ve ayarlarını yönetme'),
  ('modules.manage',            'core', 'company', 'Modülleri açma ve kapatma'),
  ('members.invite',            'core', 'company', 'Çalışan davet etme'),
  ('members.manage',            'core', 'company', 'Çalışanın rolünü değiştirme, şirketten çıkarma'),
  ('groups.create',             'core', 'company', 'Grup oluşturma'),
  ('groups.manage',             'core', 'group',   'Grup bilgisini ve üyelerini düzenleme'),
  ('audit.view',                'core', 'company', 'İşlem geçmişini görme'),
  ('archive.view',              'core', 'company', 'Kapalı modüllerin verisini salt okunur görme'),
  ('dashboard.manage_defaults', 'core', 'company', 'Varsayılan ana sayfa düzenini belirleme');

insert into public.role_permissions (role, permission)
select 'owner', key from public.permissions;

insert into public.role_permissions (role, permission)
select 'admin', key from public.permissions where key <> 'company.manage';

insert into public.group_role_permissions (role, permission) values ('manager', 'groups.manage');

-- ---------------------------------------------------------------------
-- Şirketler
-- ---------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  timezone text not null default 'Asia/Famagusta',
  -- Demo şirketi: arayüzde "DEMO VERİ" uyarısı gösterilir (gerçek modla karışmaz)
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.company_modules (
  company_id uuid not null references public.companies (id) on delete cascade,
  module_id text not null references public.modules (id),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (company_id, module_id)
);

-- ---------------------------------------------------------------------
-- Profiller (kullanıcı başına bir tane; şirketler arası ortak ad bilgisi)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 100),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
for each row execute function private.touch_updated_at();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 100),
    lower(new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(new.email) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row execute function private.handle_user_email_change();

-- ---------------------------------------------------------------------
-- Şirket üyeliği
-- ---------------------------------------------------------------------
create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'employee',
  -- Yalnızca yöneticiler için anlamlı: 'groups' ise yönetici izinleri kapsam gruplarıyla sınırlı
  admin_scope public.admin_scope not null default 'company',
  title text check (char_length(title) <= 80),
  status public.member_status not null default 'active',
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  primary key (company_id, user_id),
  -- API'de üye satırına profil (ad, e-posta) gömülebilsin diye
  constraint company_members_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade
);

create index company_members_user_active_idx on public.company_members (user_id) where status = 'active';

-- ---------------------------------------------------------------------
-- Gruplar (core: İletişim kapalıyken de görevler grup üyeliğini kullanır)
-- ---------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (company_id, id)
);

create unique index groups_company_name_uniq on public.groups (company_id, lower(name)) where archived_at is null;

create table public.group_members (
  company_id uuid not null,
  group_id uuid not null,
  user_id uuid not null,
  role public.group_role not null default 'member',
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id),
  foreign key (company_id, group_id) references public.groups (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members (company_id, user_id) on delete cascade
);

create index group_members_user_idx on public.group_members (user_id);

-- Kısıtlı yöneticinin (admin_scope = 'groups') yetki kapsamındaki gruplar
create table public.member_scope_groups (
  company_id uuid not null,
  user_id uuid not null,
  group_id uuid not null,
  primary key (company_id, user_id, group_id),
  foreign key (company_id, user_id) references public.company_members (company_id, user_id) on delete cascade,
  foreign key (company_id, group_id) references public.groups (company_id, id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Davetler (token yalnızca bir kez döner; veritabanında SHA-256 özeti tutulur)
-- ---------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  role public.member_role not null check (role <> 'owner'),
  admin_scope public.admin_scope not null default 'company',
  group_ids uuid[] not null default '{}',
  scope_group_ids uuid[] not null default '{}',
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);

create unique index invitations_pending_uniq on public.invitations (company_id, email)
where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------
-- İşlem geçmişi (yönetimsel ve güvenlikle ilgili olaylar)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_company_idx on public.audit_log (company_id, created_at desc);

-- ---------------------------------------------------------------------
-- Bildirim kutusu
-- Yalnızca doğrulanmış işlemler (RPC fonksiyonları) bildirim üretir.
-- (user_id, dedupe_key) tekilliği tekrar denemelerde çoğalmayı engeller.
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  module_id text not null references public.modules (id),
  type text not null,
  actor_id uuid references auth.users (id) on delete set null,
  entity_type text,
  entity_id uuid,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, dedupe_key)
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- =====================================================================
-- Yetki yardımcıları (private). Hepsi kullanıcı kimliğini parametre alır;
-- böylece hem oturumdaki kullanıcı (RLS) hem de bildirim alıcısı için
-- aynı kural kullanılır.
-- =====================================================================

create function private.module_enabled(p_company uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_module = 'core'
      or exists (
        select 1 from public.company_modules cm
        where cm.company_id = p_company and cm.module_id = p_module and cm.enabled
      );
$$;

create function private.user_is_member(p_user uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = p_user and m.status = 'active'
  );
$$;

create function private.is_member(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_is_member((select auth.uid()), p_company);
$$;

create function private.user_is_group_member(p_user uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    join public.company_members m on m.company_id = gm.company_id and m.user_id = gm.user_id
    where gm.group_id = p_group and gm.user_id = p_user and m.status = 'active'
  );
$$;

-- İzin kontrolü (docs/PERMISSIONS.md):
--  owner → her izin; çalışan izinleri herkes için taban;
--  grup yöneticisi → kendi grubunda group_role_permissions;
--  admin → role_permissions, admin_scope='company' ise şirket geneli,
--          'groups' ise yalnızca kapsamı 'group' olan izinlerde ve kapsam gruplarında.
--  İznin modülü kapalıysa hiç kimse için geçerli değil.
create function private.user_has_perm(p_user uuid, p_company uuid, p_perm text, p_group uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    join public.permissions p on p.key = p_perm
    where m.company_id = p_company
      and m.user_id = p_user
      and m.status = 'active'
      and private.module_enabled(p_company, p.module_id)
      and (
        m.role = 'owner'
        or exists (select 1 from public.role_permissions e where e.role = 'employee' and e.permission = p_perm)
        or (
          p_group is not null and p.scope = 'group'
          and exists (
            select 1
            from public.group_members gm
            join public.group_role_permissions gp on gp.role = gm.role and gp.permission = p_perm
            join public.groups g on g.id = gm.group_id and g.archived_at is null
            where gm.group_id = p_group and gm.user_id = p_user and gm.company_id = p_company
          )
        )
        or (
          m.role = 'admin'
          and exists (select 1 from public.role_permissions rp where rp.role = 'admin' and rp.permission = p_perm)
          and (
            m.admin_scope = 'company'
            or (
              p_group is not null and p.scope = 'group'
              and exists (
                select 1 from public.member_scope_groups s
                where s.company_id = p_company and s.user_id = p_user and s.group_id = p_group
              )
            )
          )
        )
      )
  );
$$;

create function private.has_perm(p_company uuid, p_perm text, p_group uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_has_perm((select auth.uid()), p_company, p_perm, p_group);
$$;

create function private.user_can_see_group(p_user uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group
      and private.user_is_member(p_user, g.company_id)
      and (
        private.user_is_group_member(p_user, g.id)
        or private.user_has_perm(p_user, g.company_id, 'groups.manage', g.id)
        or private.user_has_perm(p_user, g.company_id, 'tasks.view_all', g.id)
      )
  );
$$;

-- Oturumdaki kullanıcı ile hedef kullanıcı ortak bir şirkette mi (profil görünürlüğü)
create function private.shares_company(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members a
    join public.company_members b on b.company_id = a.company_id
    where a.user_id = (select auth.uid()) and a.status = 'active' and b.user_id = p_other
  );
$$;

-- Bir kullanıcının bildirime konu kayda hâlâ erişimi var mı?
-- Modüller bu fonksiyonu kendi varlık türleriyle genişletir (create or replace).
create function private.user_can_access_entity(p_user uuid, p_company uuid, p_entity_type text, p_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_entity_type
    when 'company' then private.user_is_member(p_user, p_company)
    when 'group' then private.user_can_see_group(p_user, p_entity_id)
    else false
  end;
$$;

create function private.require_member(p_company uuid)
returns public.company_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.company_members;
begin
  select * into m from public.company_members
  where company_id = p_company and user_id = private.require_uid() and status = 'active';
  if not found then
    perform private.fail('forbidden', 'Bu şirketin üyesi değilsiniz.');
  end if;
  return m;
end;
$$;

create function private.require_perm(p_company uuid, p_perm text, p_group uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_perm(p_company, p_perm, p_group) then
    perform private.fail('forbidden', 'Bu işlem için yetkiniz yok.');
  end if;
end;
$$;

create function private.require_module(p_company uuid, p_module text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.module_enabled(p_company, p_module) then
    perform private.fail('module_disabled', 'Bu modül şirketiniz için kapalı.');
  end if;
end;
$$;

create function private.audit(p_company uuid, p_action text, p_entity_type text, p_entity_id uuid, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (company_id, actor_id, action, entity_type, entity_id, data)
  values (p_company, auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_data, '{}'::jsonb));
$$;

-- Bildirim üretimi. Kurallar:
--  * işlemi yapan kişiye bildirim gitmez,
--  * modül kapalıysa üretilmez,
--  * alıcı şirketin aktif üyesi değilse veya kayda erişimi yoksa üretilmez,
--  * (alıcı, dedupe_key) daha önce varsa tekrar üretilmez.
-- Dönüş: yeni bildirim oluştu mu.
create function private.notify(
  p_company uuid,
  p_user uuid,
  p_module text,
  p_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_body text,
  p_dedupe_key text,
  p_data jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null or p_user = auth.uid() then
    return false;
  end if;
  if not private.module_enabled(p_company, p_module) then
    return false;
  end if;
  if not private.user_is_member(p_user, p_company) then
    return false;
  end if;
  if not private.user_can_access_entity(p_user, p_company, p_entity_type, p_entity_id) then
    return false;
  end if;
  insert into public.notifications (company_id, user_id, module_id, type, actor_id, entity_type, entity_id, title, body, data, dedupe_key)
  values (p_company, p_user, p_module, p_type, auth.uid(), p_entity_type, p_entity_id, p_title, coalesce(p_body, ''), coalesce(p_data, '{}'::jsonb), p_dedupe_key)
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

create function private.display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(p.full_name, ''), p.email, 'Bir kullanıcı') from public.profiles p where p.id = p_user;
$$;

-- =====================================================================
-- RLS politikaları (yalnızca okuma; yazma RPC fonksiyonlarıyla)
-- =====================================================================
alter table public.modules enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.group_role_permissions enable row level security;
alter table public.companies enable row level security;
alter table public.company_modules enable row level security;
alter table public.profiles enable row level security;
alter table public.company_members enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.member_scope_groups enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifications enable row level security;

create policy modules_read on public.modules for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy group_role_permissions_read on public.group_role_permissions for select to authenticated using (true);

create policy companies_read on public.companies for select to authenticated
using (private.is_member(id));

create policy company_modules_read on public.company_modules for select to authenticated
using (private.is_member(company_id));

create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.shares_company(id));

create policy company_members_read on public.company_members for select to authenticated
using (private.is_member(company_id));

create policy groups_read on public.groups for select to authenticated
using (private.user_can_see_group((select auth.uid()), id));

create policy group_members_read on public.group_members for select to authenticated
using (private.user_can_see_group((select auth.uid()), group_id));

create policy member_scope_groups_read on public.member_scope_groups for select to authenticated
using (
  private.is_member(company_id)
  and (user_id = (select auth.uid()) or private.has_perm(company_id, 'members.manage'))
);

create policy invitations_read on public.invitations for select to authenticated
using (private.has_perm(company_id, 'members.invite'));

create policy audit_log_read on public.audit_log for select to authenticated
using (private.has_perm(company_id, 'audit.view'));

create policy notifications_read on public.notifications for select to authenticated
using (
  user_id = (select auth.uid())
  and private.is_member(company_id)
  and private.module_enabled(company_id, module_id)
  and private.user_can_access_entity((select auth.uid()), company_id, entity_type, entity_id)
);

-- =====================================================================
-- RPC fonksiyonları — ortak temel
-- =====================================================================

-- Yeni şirket oluşturur; çağıran kişi şirket sahibi olur. Tüm modüller açık başlar.
create function public.create_company(p_name text, p_timezone text default 'Asia/Famagusta', p_is_demo boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_company uuid;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    perform private.fail('invalid', 'Şirket adı 2-120 karakter olmalı.');
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    perform private.fail('invalid', 'Geçersiz saat dilimi.');
  end if;

  -- Çift gönderim koruması: aynı kişi aynı adla son 1 dakikada şirket oluşturduysa onu döndür.
  select c.id into v_company
  from public.companies c
  where c.created_by = v_uid and lower(c.name) = lower(v_name) and c.created_at > now() - interval '1 minute'
  limit 1;
  if v_company is not null then
    return v_company;
  end if;

  insert into public.companies (name, timezone, is_demo, created_by)
  values (v_name, p_timezone, coalesce(p_is_demo, false), v_uid)
  returning id into v_company;

  insert into public.company_members (company_id, user_id, role) values (v_company, v_uid, 'owner');

  insert into public.company_modules (company_id, module_id, enabled, updated_by)
  select v_company, m.id, true, v_uid from public.modules m where not m.is_core;

  perform private.audit(v_company, 'company.created', 'company', v_company, jsonb_build_object('name', v_name));
  return v_company;
end;
$$;

create function public.update_company(p_company uuid, p_name text, p_timezone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_member(p_company);
  perform private.require_perm(p_company, 'company.manage');
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    perform private.fail('invalid', 'Şirket adı 2-120 karakter olmalı.');
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    perform private.fail('invalid', 'Geçersiz saat dilimi.');
  end if;
  update public.companies set name = v_name, timezone = p_timezone where id = p_company;
  perform private.audit(p_company, 'company.updated', 'company', p_company, jsonb_build_object('name', v_name, 'timezone', p_timezone));
end;
$$;

create function public.update_my_profile(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := btrim(coalesce(p_full_name, ''));
begin
  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    perform private.fail('invalid', 'Ad soyad 2-100 karakter olmalı.');
  end if;
  update public.profiles set full_name = v_name where id = v_uid;
end;
$$;

-- Modül açma/kapama. Veri silinmez. Bağımlılık kuralları docs/MODULES.md'de.
create function public.set_module_enabled(p_company uuid, p_module text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mod public.modules;
  v_blockers text[];
begin
  perform private.require_member(p_company);
  perform private.require_perm(p_company, 'modules.manage');
  select * into v_mod from public.modules where id = p_module;
  if not found then
    perform private.fail('not_found', 'Modül bulunamadı.');
  end if;
  if v_mod.is_core then
    perform private.fail('invalid', 'Temel modül kapatılamaz.');
  end if;

  if p_enabled then
    select array_agg(d) into v_blockers
    from unnest(v_mod.depends_on) d
    where not private.module_enabled(p_company, d);
    if v_blockers is not null then
      perform private.fail('invalid', 'Önce bağımlı olduğu modülleri açın: ' || array_to_string(v_blockers, ', '));
    end if;
  else
    select array_agg(m.id) into v_blockers
    from public.modules m
    where p_module = any (m.depends_on) and private.module_enabled(p_company, m.id);
    if v_blockers is not null then
      perform private.fail('invalid', 'Önce bu modüle bağımlı modülleri kapatın: ' || array_to_string(v_blockers, ', '));
    end if;
  end if;

  insert into public.company_modules (company_id, module_id, enabled, updated_at, updated_by)
  values (p_company, p_module, p_enabled, now(), auth.uid())
  on conflict (company_id, module_id)
  do update set enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  perform private.audit(p_company, case when p_enabled then 'module.enabled' else 'module.disabled' end, 'module', null, jsonb_build_object('module', p_module));
end;
$$;

-- ---------------------------------------------------------------------
-- Gruplar
-- ---------------------------------------------------------------------
create function private.assert_active_members(p_company uuid, p_users uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from unnest(coalesce(p_users, '{}')) u where not private.user_is_member(u, p_company)) then
    perform private.fail('invalid', 'Seçilen kişilerden biri bu şirketin aktif üyesi değil.');
  end if;
end;
$$;

create function public.create_group(
  p_company uuid,
  p_name text,
  p_description text default '',
  p_member_ids uuid[] default '{}',
  p_manager_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_group uuid;
  v_all uuid[];
  u uuid;
begin
  perform private.require_member(p_company);
  perform private.require_perm(p_company, 'groups.create');
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    perform private.fail('invalid', 'Grup adı 2-80 karakter olmalı.');
  end if;
  v_all := array(select distinct x from unnest(coalesce(p_member_ids, '{}') || coalesce(p_manager_ids, '{}')) x);
  perform private.assert_active_members(p_company, v_all);

  begin
    insert into public.groups (company_id, name, description, created_by)
    values (p_company, v_name, left(btrim(coalesce(p_description, '')), 500), v_uid)
    returning id into v_group;
  exception when unique_violation then
    perform private.fail('conflict', 'Bu isimde bir grup zaten var.');
  end;

  insert into public.group_members (company_id, group_id, user_id, role, added_by)
  select p_company, v_group, x,
         case when x = any (coalesce(p_manager_ids, '{}')) then 'manager'::public.group_role else 'member'::public.group_role end,
         v_uid
  from unnest(v_all) x;

  perform private.audit(p_company, 'group.created', 'group', v_group, jsonb_build_object('name', v_name, 'members', to_jsonb(v_all)));

  foreach u in array v_all loop
    perform private.notify(p_company, u, 'core', 'group_added', 'group', v_group,
      'Gruba eklendiniz', v_name || ' grubuna eklendiniz.', 'group_added:' || v_group || ':' || u);
  end loop;
  return v_group;
end;
$$;

create function public.update_group(p_group uuid, p_name text, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.groups;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select * into v_g from public.groups where id = p_group;
  if not found or not private.user_can_see_group(private.require_uid(), p_group) then
    perform private.fail('not_found', 'Grup bulunamadı.');
  end if;
  perform private.require_perm(v_g.company_id, 'groups.manage', p_group);
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    perform private.fail('invalid', 'Grup adı 2-80 karakter olmalı.');
  end if;
  begin
    update public.groups set name = v_name, description = left(btrim(coalesce(p_description, '')), 500) where id = p_group;
  exception when unique_violation then
    perform private.fail('conflict', 'Bu isimde bir grup zaten var.');
  end;
  perform private.audit(v_g.company_id, 'group.updated', 'group', p_group, jsonb_build_object('name', v_name));
end;
$$;

create function public.add_group_members(p_group uuid, p_user_ids uuid[], p_role public.group_role default 'member')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups;
  v_added uuid[];
  u uuid;
begin
  select * into v_g from public.groups where id = p_group and archived_at is null;
  if not found or not private.user_can_see_group(v_uid, p_group) then
    perform private.fail('not_found', 'Grup bulunamadı.');
  end if;
  perform private.require_perm(v_g.company_id, 'groups.manage', p_group);
  perform private.assert_active_members(v_g.company_id, p_user_ids);

  with ins as (
    insert into public.group_members (company_id, group_id, user_id, role, added_by)
    select v_g.company_id, p_group, x, coalesce(p_role, 'member'), v_uid
    from unnest(coalesce(p_user_ids, '{}')) x
    on conflict (group_id, user_id) do nothing
    returning user_id
  )
  select coalesce(array_agg(user_id), '{}') into v_added from ins;

  if cardinality(v_added) > 0 then
    perform private.audit(v_g.company_id, 'group.members_added', 'group', p_group, jsonb_build_object('users', to_jsonb(v_added)));
    foreach u in array v_added loop
      perform private.notify(v_g.company_id, u, 'core', 'group_added', 'group', p_group,
        'Gruba eklendiniz', v_g.name || ' grubuna eklendiniz.', 'group_added:' || p_group || ':' || u || ':' || extract(epoch from now())::bigint);
    end loop;
  end if;
  return cardinality(v_added);
end;
$$;

-- Gruptan çıkarma. Kişi kendini de çıkarabilir (gruptan ayrılma).
-- Çıkarılan kişinin grup mesajlarına, dosyalarına ve grup görevlerine erişimi
-- RLS ile anında kalkar (sorumlu/katkıda bulunan olduğu görevler hariç).
create function public.remove_group_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups;
begin
  select * into v_g from public.groups where id = p_group;
  if not found or not private.user_can_see_group(v_uid, p_group) then
    perform private.fail('not_found', 'Grup bulunamadı.');
  end if;
  if p_user <> v_uid then
    perform private.require_perm(v_g.company_id, 'groups.manage', p_group);
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  if found then
    perform private.audit(v_g.company_id, 'group.member_removed', 'group', p_group, jsonb_build_object('user', p_user));
  end if;
end;
$$;

create function public.set_group_member_role(p_group uuid, p_user uuid, p_role public.group_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.groups;
begin
  select * into v_g from public.groups where id = p_group;
  if not found or not private.user_can_see_group(private.require_uid(), p_group) then
    perform private.fail('not_found', 'Grup bulunamadı.');
  end if;
  perform private.require_perm(v_g.company_id, 'groups.manage', p_group);
  update public.group_members set role = p_role where group_id = p_group and user_id = p_user;
  if not found then
    perform private.fail('not_found', 'Kişi bu grubun üyesi değil.');
  end if;
  perform private.audit(v_g.company_id, 'group.member_role_changed', 'group', p_group, jsonb_build_object('user', p_user, 'role', p_role));
end;
$$;

create function public.archive_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.groups;
begin
  select * into v_g from public.groups where id = p_group and archived_at is null;
  if not found or not private.user_can_see_group(private.require_uid(), p_group) then
    perform private.fail('not_found', 'Grup bulunamadı.');
  end if;
  perform private.require_perm(v_g.company_id, 'groups.create');
  update public.groups set archived_at = now() where id = p_group;
  perform private.audit(v_g.company_id, 'group.archived', 'group', p_group, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- Üye yönetimi
-- ---------------------------------------------------------------------

-- Rol değişikliği. Yönetici rolü verme/alma ve kapsam değiştirme yalnızca şirket sahibindedir.
create function public.change_member_role(
  p_company uuid,
  p_user uuid,
  p_role public.member_role,
  p_admin_scope public.admin_scope default 'company',
  p_scope_group_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.company_members;
  v_target public.company_members;
begin
  v_me := private.require_member(p_company);
  perform private.require_perm(p_company, 'members.manage');
  if v_me.role <> 'owner' then
    perform private.fail('forbidden', 'Rolleri yalnızca şirket sahibi değiştirebilir.');
  end if;
  if p_user = v_me.user_id then
    perform private.fail('invalid', 'Kendi rolünüzü değiştiremezsiniz.');
  end if;
  if p_role = 'owner' then
    perform private.fail('invalid', 'Şirket sahipliği bu işlemle devredilemez.');
  end if;
  select * into v_target from public.company_members where company_id = p_company and user_id = p_user and status = 'active' for update;
  if not found then
    perform private.fail('not_found', 'Üye bulunamadı.');
  end if;
  if v_target.role = 'owner' then
    perform private.fail('forbidden', 'Şirket sahibinin rolü değiştirilemez.');
  end if;
  if p_role = 'admin' and p_admin_scope = 'groups' and coalesce(cardinality(p_scope_group_ids), 0) = 0 then
    perform private.fail('invalid', 'Kısıtlı yönetici için en az bir grup seçin.');
  end if;
  if exists (
    select 1 from unnest(coalesce(p_scope_group_ids, '{}')) g
    where not exists (select 1 from public.groups x where x.id = g and x.company_id = p_company and x.archived_at is null)
  ) then
    perform private.fail('invalid', 'Seçilen gruplardan biri bu şirkete ait değil.');
  end if;

  update public.company_members
  set role = p_role,
      admin_scope = case when p_role = 'admin' then coalesce(p_admin_scope, 'company') else 'company' end
  where company_id = p_company and user_id = p_user;

  delete from public.member_scope_groups where company_id = p_company and user_id = p_user;
  if p_role = 'admin' and p_admin_scope = 'groups' then
    insert into public.member_scope_groups (company_id, user_id, group_id)
    select distinct p_company, p_user, g from unnest(p_scope_group_ids) g;
  end if;

  perform private.audit(p_company, 'member.role_changed', 'member', p_user, jsonb_build_object(
    'from', v_target.role, 'to', p_role, 'admin_scope', p_admin_scope, 'scope_groups', to_jsonb(coalesce(p_scope_group_ids, '{}'))));
end;
$$;

-- Şirketten çıkarma: üyelik 'removed' olur, grup üyelikleri silinir.
-- Erişim RLS ile anında kalkar (her sorgu aktif üyeliği kontrol eder).
create function public.remove_member(p_company uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.company_members;
  v_target public.company_members;
begin
  v_me := private.require_member(p_company);
  perform private.require_perm(p_company, 'members.manage');
  if p_user = v_me.user_id then
    perform private.fail('invalid', 'Kendinizi şirketten çıkaramazsınız.');
  end if;
  select * into v_target from public.company_members where company_id = p_company and user_id = p_user for update;
  if not found or v_target.status <> 'active' then
    perform private.fail('not_found', 'Üye bulunamadı.');
  end if;
  if v_target.role = 'owner' then
    perform private.fail('forbidden', 'Şirket sahibi çıkarılamaz.');
  end if;
  if v_target.role = 'admin' and v_me.role <> 'owner' then
    perform private.fail('forbidden', 'Yöneticileri yalnızca şirket sahibi çıkarabilir.');
  end if;

  update public.company_members
  set status = 'removed', removed_at = now(), removed_by = v_me.user_id
  where company_id = p_company and user_id = p_user;
  delete from public.group_members where company_id = p_company and user_id = p_user;
  delete from public.member_scope_groups where company_id = p_company and user_id = p_user;

  perform private.audit(p_company, 'member.removed', 'member', p_user, jsonb_build_object('role', v_target.role));
end;
$$;

-- ---------------------------------------------------------------------
-- Davetler
-- ---------------------------------------------------------------------
create function private.hash_token(p_token text)
returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create function public.create_invitation(
  p_company uuid,
  p_email text,
  p_role public.member_role,
  p_admin_scope public.admin_scope default 'company',
  p_group_ids uuid[] default '{}',
  p_scope_group_ids uuid[] default '{}'
)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.company_members;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_scope public.admin_scope := case when p_role = 'admin' then coalesce(p_admin_scope, 'company') else 'company' end;
begin
  v_me := private.require_member(p_company);
  perform private.require_perm(p_company, 'members.invite');
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    perform private.fail('invalid', 'Geçerli bir e-posta adresi girin.');
  end if;
  if p_role = 'owner' then
    perform private.fail('invalid', 'Şirket sahibi davet edilemez.');
  end if;
  if p_role = 'admin' and v_me.role <> 'owner' then
    perform private.fail('forbidden', 'Yönetici davetini yalnızca şirket sahibi gönderebilir.');
  end if;
  if p_role = 'admin' and v_scope = 'groups' and coalesce(cardinality(p_scope_group_ids), 0) = 0 then
    perform private.fail('invalid', 'Kısıtlı yönetici için en az bir grup seçin.');
  end if;
  if exists (
    select 1 from unnest(coalesce(p_group_ids, '{}') || coalesce(p_scope_group_ids, '{}')) g
    where not exists (select 1 from public.groups x where x.id = g and x.company_id = p_company and x.archived_at is null)
  ) then
    perform private.fail('invalid', 'Seçilen gruplardan biri bu şirkete ait değil.');
  end if;
  if exists (
    select 1 from public.company_members m join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.status = 'active' and p.email = v_email
  ) then
    perform private.fail('conflict', 'Bu e-posta adresi zaten şirketin üyesi.');
  end if;

  -- Aynı adrese bekleyen eski davet varsa geçersiz kılınır (tek geçerli bağlantı kalır).
  update public.invitations set revoked_at = now()
  where company_id = p_company and email = v_email and accepted_at is null and revoked_at is null;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.invitations (company_id, email, role, admin_scope, group_ids, scope_group_ids, token_hash, invited_by)
  values (
    p_company, v_email, p_role, v_scope,
    array(select distinct g from unnest(coalesce(p_group_ids, '{}')) g),
    case when v_scope = 'groups' then array(select distinct g from unnest(p_scope_group_ids) g) else '{}' end,
    private.hash_token(v_token),
    v_me.user_id
  )
  returning id into v_id;

  perform private.audit(p_company, 'member.invited', 'invitation', v_id, jsonb_build_object('email', v_email, 'role', p_role));
  return query select v_id, v_token;
end;
$$;

create function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where id = p_invitation;
  if not found then
    perform private.fail('not_found', 'Davet bulunamadı.');
  end if;
  perform private.require_member(v_inv.company_id);
  perform private.require_perm(v_inv.company_id, 'members.invite');
  update public.invitations set revoked_at = now() where id = p_invitation and accepted_at is null and revoked_at is null;
  perform private.audit(v_inv.company_id, 'member.invitation_revoked', 'invitation', p_invitation, jsonb_build_object('email', v_inv.email));
end;
$$;

-- Davet sayfası için asgari bilgi (oturum açmamış kişi de çağırabilir; token gizlidir).
create function public.get_invitation(p_token text)
returns table (company_name text, email text, role public.member_role, status text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name, i.email, i.role,
         case
           when i.accepted_at is not null then 'accepted'
           when i.revoked_at is not null then 'revoked'
           when i.expires_at < now() then 'expired'
           else 'pending'
         end,
         i.expires_at
  from public.invitations i
  join public.companies c on c.id = i.company_id
  where i.token_hash = private.hash_token(p_token);
$$;

create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_inv public.invitations;
  v_email text;
  v_existing public.company_members;
begin
  select * into v_inv from public.invitations where token_hash = private.hash_token(p_token) for update;
  if not found then
    perform private.fail('not_found', 'Davet bulunamadı.');
  end if;
  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = v_uid then
      return v_inv.company_id; -- tekrar deneme: aynı sonuç
    end if;
    perform private.fail('conflict', 'Bu davet zaten kullanılmış.');
  end if;
  if v_inv.revoked_at is not null then
    perform private.fail('invalid', 'Bu davet iptal edilmiş.');
  end if;
  if v_inv.expires_at < now() then
    perform private.fail('invalid', 'Bu davetin süresi dolmuş. Yöneticinizden yeni davet isteyin.');
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_inv.email then
    perform private.fail('forbidden', 'Bu davet başka bir e-posta adresi için gönderilmiş.');
  end if;

  select * into v_existing from public.company_members where company_id = v_inv.company_id and user_id = v_uid for update;
  if found then
    if v_existing.status = 'removed' then
      update public.company_members
      set status = 'active', role = v_inv.role, admin_scope = v_inv.admin_scope,
          removed_at = null, removed_by = null, joined_at = now()
      where company_id = v_inv.company_id and user_id = v_uid;
    end if;
  else
    insert into public.company_members (company_id, user_id, role, admin_scope)
    values (v_inv.company_id, v_uid, v_inv.role, v_inv.admin_scope);
  end if;

  insert into public.group_members (company_id, group_id, user_id, added_by)
  select v_inv.company_id, g.id, v_uid, v_inv.invited_by
  from public.groups g
  where g.id = any (v_inv.group_ids) and g.company_id = v_inv.company_id and g.archived_at is null
  on conflict (group_id, user_id) do nothing;

  insert into public.member_scope_groups (company_id, user_id, group_id)
  select v_inv.company_id, v_uid, g.id
  from public.groups g
  where g.id = any (v_inv.scope_group_ids) and g.company_id = v_inv.company_id and g.archived_at is null
  on conflict do nothing;

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;

  perform private.audit(v_inv.company_id, 'member.joined', 'member', v_uid, jsonb_build_object('invitation', v_inv.id, 'role', v_inv.role));
  perform private.notify(v_inv.company_id, v_inv.invited_by, 'core', 'invite_accepted', 'company', v_inv.company_id,
    'Davet kabul edildi', private.display_name(v_uid) || ' ekibe katıldı.', 'invite_accepted:' || v_inv.id);
  return v_inv.company_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Bildirimler
-- ---------------------------------------------------------------------
create function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications
  set read_at = now()
  where user_id = private.require_uid()
    and read_at is null
    and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =====================================================================
-- Realtime: bildirim kutusu canlı güncellenir (RLS aboneye göre uygulanır)
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- =====================================================================
-- API yetkileri. Her migration sonunda yeniden uygulanır.
-- anon: hiçbir tabloya erişemez; yalnızca izinli RPC'leri çağırabilir.
-- authenticated: tablolarda yalnızca SELECT (RLS süzer); yazma RPC ile.
-- =====================================================================
create function private.apply_api_grants()
returns void
language plpgsql
as $$
begin
  execute 'revoke all on all tables in schema public from anon, authenticated';
  execute 'revoke all on all sequences in schema public from anon, authenticated';
  execute 'grant select on all tables in schema public to authenticated';
  execute 'revoke all on all functions in schema public from public, anon, authenticated';
  execute 'grant execute on all functions in schema public to authenticated';
  execute 'grant execute on function public.get_invitation(text) to anon';
  execute 'grant all on all tables in schema public to service_role';
  execute 'grant all on all sequences in schema public to service_role';
  execute 'grant execute on all functions in schema public to service_role';
  execute 'revoke all on all functions in schema private from public, anon';
  execute 'grant execute on all functions in schema private to authenticated, service_role';
  execute 'revoke all on function private.apply_api_grants() from authenticated';
end;
$$;

select private.apply_api_grants();
