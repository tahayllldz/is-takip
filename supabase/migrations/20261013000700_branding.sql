-- =====================================================================
-- ŞİRKET MARKA TEMASI (core)
-- Logo (özel depo) + logodan çıkarılan palet + elle düzenlenen renkler + hangi arayüz
-- bölümünün marka rengini kullanacağı (hedefler) + hazır tema seçimi.
-- Renk/kontrast hesabı istemcide ortak kodla yapılır (packages/shared/src/branding.ts);
-- sunucu yalnızca yapıyı, değerlerin biçimini, yetkiyi ve şirket sınırını zorlar.
-- Görünüm erişimi değiştirmez: tema yalnızca renkleri belirler.
-- =====================================================================

insert into public.permissions (key, module_id, scope, label) values
  ('branding.manage', 'core', 'company', 'Şirket logosunu ve uygulama renklerini yönetme');

insert into public.role_permissions (role, permission) values ('owner', 'branding.manage'), ('admin', 'branding.manage');

-- Tema hedefleri: arayüzde marka rengini alabilen bölümler ve her birinin kullanabileceği palet renkleri.
-- packages/shared/src/branding.ts → THEME_TARGETS ile aynı olmalı (db-tests karşılaştırır).
create table public.branding_targets (
  id text primary key,
  allowed_tokens text[] not null,
  sort_order integer not null default 0
);

insert into public.branding_targets (id, allowed_tokens, sort_order) values
  ('header',          array['surfaceLight', 'surfaceDark', 'primary'], 10),
  ('tabBar',          array['surfaceLight', 'surfaceDark', 'primary'], 20),
  ('navActive',       array['primary', 'secondary', 'accent'],         30),
  ('hero',            array['surfaceLight', 'surfaceDark', 'primary'], 40),
  ('primaryButton',   array['primary', 'secondary', 'accent'],         50),
  ('secondaryButton', array['primary', 'secondary', 'accent'],         60),
  ('cards',           array['border', 'surfaceLight'],                 70),
  ('links',           array['primary', 'secondary', 'accent'],         80),
  ('selection',       array['primary', 'secondary', 'accent'],         90),
  ('forms',           array['primary', 'secondary', 'accent'],        100),
  ('badges',          array['primary', 'secondary', 'accent'],        110),
  ('charts',          array['primary', 'secondary', 'accent'],        120),
  ('text',            array['textPrimary'],                           130);

create table public.company_branding (
  company_id uuid primary key references public.companies (id) on delete cascade,
  -- Özel depodaki logo ('company-branding' kovası, '<şirket>/logo-<uuid>.png'); yoksa null
  logo_path text,
  -- Saydam logonun arkasına konacak zemin
  logo_background text not null default 'none' check (logo_background in ('none', 'light', 'dark', 'brand')),
  -- Logodan çıkarılan (veya ilk kurulan) tam palet; "logodan gelen renklere dön" bunu kullanır
  palette jsonb not null,
  -- Elle değiştirilen renkler (palet anahtarlarının alt kümesi)
  overrides jsonb not null default '{}'::jsonb,
  -- Logodaki baskın renkler (önerileri yeniden üretmek ve renk seçtirmek için)
  swatches jsonb not null default '[]'::jsonb,
  -- Hedef → { enabled, token }
  targets jsonb not null,
  preset text not null check (preset in ('original', 'recommended', 'light_brand', 'dark_brand', 'custom')),
  -- Uygulamada şimdilik yalnızca açık görünüm var
  mode text not null default 'light' check (mode in ('light')),
  -- Yapılandırma biçiminin sürümü (ileride alan eklenirse dönüştürmek için)
  config_version smallint not null default 1,
  -- Satır sürümü: aynı anda iki yöneticinin birbirinin kaydını ezmemesi için
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- =====================================================================
-- Doğrulama
-- =====================================================================
create function private.valid_hex(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Eksik anahtar (null) da geçersizdir: null dönerse "if not ..." koşulu hiç çalışmaz
  select coalesce(jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^#[0-9a-f]{6}$', false);
$$;

-- Logo yolu → şirket kimliği (biçim yanlışsa null; politikalarda güvenli dönüşüm)
create function private.branding_path_company(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

create function private.validate_branding(p_company uuid, p_config jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  palette_keys constant text[] := array['primary', 'secondary', 'accent', 'surfaceLight', 'surfaceDark', 'textPrimary', 'textSecondary', 'border'];
  k text;
  f text;
  v jsonb;
  t record;
  v_logo text;
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    perform private.fail('invalid', 'Tema ayarları eksik.');
  end if;
  for k in select jsonb_object_keys(p_config) loop
    if not (k = any (array['logoPath', 'logoBackground', 'palette', 'overrides', 'swatches', 'targets', 'preset', 'mode'])) then
      perform private.fail('invalid', 'Bilinmeyen tema alanı: ' || k);
    end if;
  end loop;

  -- Palet: sekiz rengin hepsi, #rrggbb biçiminde
  if jsonb_typeof(p_config -> 'palette') is distinct from 'object' then
    perform private.fail('invalid', 'Renk paleti eksik.');
  end if;
  foreach k in array palette_keys loop
    if not private.valid_hex(p_config -> 'palette' -> k) then
      perform private.fail('invalid', 'Geçersiz renk: ' || k);
    end if;
  end loop;
  for k in select jsonb_object_keys(p_config -> 'palette') loop
    if not (k = any (palette_keys)) then
      perform private.fail('invalid', 'Bilinmeyen palet rengi: ' || k);
    end if;
  end loop;

  -- Elle değişiklikler: palet anahtarlarının alt kümesi
  if jsonb_typeof(coalesce(p_config -> 'overrides', '{}'::jsonb)) <> 'object' then
    perform private.fail('invalid', 'Renk değişiklikleri geçersiz.');
  end if;
  for k, v in select * from jsonb_each(coalesce(p_config -> 'overrides', '{}'::jsonb)) loop
    if not (k = any (palette_keys)) or not private.valid_hex(v) then
      perform private.fail('invalid', 'Geçersiz renk değişikliği: ' || k);
    end if;
  end loop;

  -- Logodaki renkler: en fazla 8, { color, share }
  if jsonb_typeof(coalesce(p_config -> 'swatches', '[]'::jsonb)) <> 'array' then
    perform private.fail('invalid', 'Logo renkleri geçersiz.');
  end if;
  if jsonb_array_length(coalesce(p_config -> 'swatches', '[]'::jsonb)) > 8 then
    perform private.fail('invalid', 'Logo renkleri geçersiz.');
  end if;
  for v in select * from jsonb_array_elements(coalesce(p_config -> 'swatches', '[]'::jsonb)) loop
    if jsonb_typeof(v) is distinct from 'object' or not private.valid_hex(v -> 'color')
       or not coalesce(case when jsonb_typeof(v -> 'share') = 'number' then (v ->> 'share')::numeric between 0 and 1 end, false) then
      perform private.fail('invalid', 'Logo renkleri geçersiz.');
    end if;
  end loop;

  -- Hedefler: bilinen hedef, { enabled: boolean, token: izin verilen palet rengi }
  if jsonb_typeof(p_config -> 'targets') is distinct from 'object' then
    perform private.fail('invalid', 'Tema hedefleri eksik.');
  end if;
  for k, v in select * from jsonb_each(p_config -> 'targets') loop
    select * into t from public.branding_targets b where b.id = k;
    if not found then
      perform private.fail('invalid', 'Bilinmeyen tema hedefi: ' || k);
    end if;
    if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v -> 'enabled') is distinct from 'boolean'
       or jsonb_typeof(v -> 'token') is distinct from 'string' or not coalesce((v ->> 'token') = any (t.allowed_tokens), false) then
      perform private.fail('invalid', 'Geçersiz tema hedefi ayarı: ' || k);
    end if;
    for f in select jsonb_object_keys(v) loop
      if not (f = any (array['enabled', 'token'])) then
        perform private.fail('invalid', 'Geçersiz tema hedefi ayarı: ' || k);
      end if;
    end loop;
  end loop;

  if coalesce(p_config ->> 'preset', '') not in ('original', 'recommended', 'light_brand', 'dark_brand', 'custom') then
    perform private.fail('invalid', 'Geçersiz hazır tema.');
  end if;
  if coalesce(p_config ->> 'mode', 'light') <> 'light' then
    perform private.fail('invalid', 'Geçersiz görünüm modu.');
  end if;
  if coalesce(p_config ->> 'logoBackground', 'none') not in ('none', 'light', 'dark', 'brand') then
    perform private.fail('invalid', 'Geçersiz logo zemini.');
  end if;

  -- Logo: yalnızca bu şirketin klasöründe ve gerçekten yüklenmiş bir dosya
  if jsonb_typeof(p_config -> 'logoPath') = 'string' then
    v_logo := p_config ->> 'logoPath';
    if private.branding_path_company(v_logo) is distinct from p_company then
      perform private.fail('invalid', 'Logo bu şirkete ait değil.');
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'company-branding' and o.name = v_logo) then
      perform private.fail('invalid', 'Logo dosyası bulunamadı; yeniden yükleyin.');
    end if;
  elsif p_config ? 'logoPath' and jsonb_typeof(p_config -> 'logoPath') <> 'null' then
    perform private.fail('invalid', 'Logo yolu geçersiz.');
  end if;
end;
$$;

-- =====================================================================
-- Dosya deposu: özel kova, yalnızca PNG/JPEG, 2 MB
-- Okuma: şirketin aktif üyeleri. Yükleme: branding.manage. Silme: branding.manage ve şu an kullanılmayan logo.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-branding', 'company-branding', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy company_branding_read on storage.objects for select to authenticated
using (
  bucket_id = 'company-branding'
  and private.user_is_member((select auth.uid()), private.branding_path_company(name))
);

create policy company_branding_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-branding'
  and private.user_has_perm((select auth.uid()), private.branding_path_company(name), 'branding.manage')
);

create policy company_branding_delete_unused on storage.objects for delete to authenticated
using (
  bucket_id = 'company-branding'
  and private.user_has_perm((select auth.uid()), private.branding_path_company(name), 'branding.manage')
  and not exists (select 1 from public.company_branding b where b.logo_path = name)
);

-- =====================================================================
-- RLS: şirketin her aktif üyesi temayı okur (uygulamayı o renklerle görmek için). Yazma yalnızca RPC ile.
-- =====================================================================
alter table public.branding_targets enable row level security;
alter table public.company_branding enable row level security;

create policy branding_targets_read on public.branding_targets for select to authenticated using (true);

create policy company_branding_read on public.company_branding for select to authenticated
using (private.is_member(company_id));

-- =====================================================================
-- RPC fonksiyonları
-- =====================================================================
create function public.save_company_branding(p_company uuid, p_config jsonb, p_expected_version integer default null)
returns public.company_branding
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.company_branding;
  res public.company_branding;
  v_logo text;
begin
  perform private.require_member(p_company);
  perform private.require_perm(p_company, 'branding.manage');
  perform private.validate_branding(p_company, p_config);
  v_logo := case when jsonb_typeof(p_config -> 'logoPath') = 'string' then p_config ->> 'logoPath' end;

  select * into cur from public.company_branding b where b.company_id = p_company for update;
  if found and (p_expected_version is null or cur.version <> p_expected_version) then
    perform private.fail('conflict', 'Marka ayarları siz düzenlerken başka biri tarafından değiştirildi. Yenileyip tekrar deneyin.');
  end if;
  if not found and p_expected_version is not null then
    perform private.fail('conflict', 'Marka ayarları siz düzenlerken sıfırlandı. Yenileyip tekrar deneyin.');
  end if;

  insert into public.company_branding as b (
    company_id, logo_path, logo_background, palette, overrides, swatches, targets, preset, mode, version, updated_at, updated_by
  )
  values (
    p_company, v_logo, coalesce(p_config ->> 'logoBackground', 'none'), p_config -> 'palette',
    coalesce(p_config -> 'overrides', '{}'::jsonb), coalesce(p_config -> 'swatches', '[]'::jsonb),
    p_config -> 'targets', p_config ->> 'preset', coalesce(p_config ->> 'mode', 'light'), 1, now(), auth.uid()
  )
  on conflict (company_id) do update set
    logo_path = excluded.logo_path,
    logo_background = excluded.logo_background,
    palette = excluded.palette,
    overrides = excluded.overrides,
    swatches = excluded.swatches,
    targets = excluded.targets,
    preset = excluded.preset,
    mode = excluded.mode,
    version = b.version + 1,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  returning * into res;

  perform private.audit(p_company, 'branding.saved', 'company', p_company,
    jsonb_build_object('preset', res.preset, 'logo', res.logo_path is not null,
      'logo_changed', cur.company_id is null or cur.logo_path is distinct from res.logo_path));
  return res;
end;
$$;

-- Uygulamanın kendi temasına dön. Eski logo yolunu döndürür (istemci depodan siler; SQL depoyu silemez).
create function public.reset_company_branding(p_company uuid, p_expected_version integer default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.company_branding;
begin
  perform private.require_member(p_company);
  perform private.require_perm(p_company, 'branding.manage');
  select * into cur from public.company_branding b where b.company_id = p_company for update;
  if not found then
    return null;
  end if;
  if p_expected_version is not null and cur.version <> p_expected_version then
    perform private.fail('conflict', 'Marka ayarları siz düzenlerken başka biri tarafından değiştirildi. Yenileyip tekrar deneyin.');
  end if;
  delete from public.company_branding b where b.company_id = p_company;
  perform private.audit(p_company, 'branding.reset', 'company', p_company, jsonb_build_object('logo', cur.logo_path is not null));
  return cur.logo_path;
end;
$$;

-- Tema değişince açık uygulamalar yenilensin (yalnızca sinyal; veri RLS'li sorguyla gelir)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.company_branding;
  end if;
end;
$$;

select private.apply_api_grants();
