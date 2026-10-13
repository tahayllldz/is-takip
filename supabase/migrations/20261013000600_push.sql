-- =====================================================================
-- PUSH BİLDİRİMLERİ (core)
--
-- * Cihaz kaydı: kullanıcı kendi Expo push token'ını kaydeder (mobil uygulama, kendi oturumuyla).
-- * Kuyruk: yalnızca doğrulanmış işlemlerin ürettiği bildirimlerden (private.notify → notifications)
--   tetikleyiciyle dolar; bildirim başına en fazla bir kayıt (tekrar denemede çoğalmaz).
-- * Gönderim: sunucudaki gönderici (yönetim anahtarıyla, istemcide değil) kuyruğu alır, gönderim anında
--   erişimi yeniden doğrular (üyelik, modül, kayda erişim) ve Expo push servisine GENEL bir metin gönderir.
--   Kilit ekranına görev/mesaj içeriği, kişi veya şirket adı taşınmaz; ayrıntı uygulamada RLS ile görülür.
-- =====================================================================

create type public.push_platform as enum ('ios', 'android');
create type public.push_status as enum ('pending', 'sending', 'sent', 'failed', 'skipped');

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_token text not null unique check (expo_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$'),
  platform public.push_platform not null,
  device_name text check (device_name is null or char_length(device_name) <= 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text
);

create index push_devices_user_active_idx on public.push_devices (user_id) where disabled_at is null;

create table public.push_outbox (
  id bigint generated always as identity primary key,
  notification_id uuid not null unique references public.notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  status public.push_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  tickets jsonb,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);

create index push_outbox_open_idx on public.push_outbox (created_at) where status in ('pending', 'sending');

-- Doğrulanmış bildirim → push kuyruğu (yalnızca etkin cihazı olan kişi için)
create function private.enqueue_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.push_devices d where d.user_id = new.user_id and d.disabled_at is null) then
    insert into public.push_outbox (notification_id, user_id, company_id)
    values (new.id, new.user_id, new.company_id)
    on conflict (notification_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger notifications_enqueue_push after insert on public.notifications
for each row execute function private.enqueue_push();

-- =====================================================================
-- RLS: cihazını yalnızca sahibi görür; kuyruğu istemci hiç göremez (politika yok)
-- =====================================================================
alter table public.push_devices enable row level security;
alter table public.push_outbox enable row level security;

create policy push_devices_read_own on public.push_devices for select to authenticated
using (user_id = (select auth.uid()));

-- =====================================================================
-- İstemci RPC'leri
-- =====================================================================

-- Aynı token başka hesapla kayıtlıysa (cihazda farklı kullanıcı oturum açtı) bu kullanıcıya geçer.
create function public.register_push_device(p_token text, p_platform public.push_platform, p_device_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid;
begin
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$' then
    perform private.fail('invalid', 'Geçersiz bildirim anahtarı.');
  end if;
  insert into public.push_devices (user_id, expo_token, platform, device_name)
  values (v_uid, p_token, p_platform, left(nullif(btrim(coalesce(p_device_name, '')), ''), 80))
  on conflict (expo_token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        device_name = excluded.device_name,
        last_seen_at = now(),
        disabled_at = null,
        disabled_reason = null
  returning id into v_id;
  return v_id;
end;
$$;

-- Çıkış yapınca veya kullanıcı kapatınca bu cihaza push gitmez
create function public.unregister_push_device(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_devices
  set disabled_at = now(), disabled_reason = 'kullanıcı kapattı'
  where expo_token = p_token and user_id = private.require_uid() and disabled_at is null;
end;
$$;

-- =====================================================================
-- Gönderici (YALNIZCA service_role — web sunucusundaki gönderim uç noktası)
-- =====================================================================

-- Gönderilecek kayıtları alır. Gönderim anında erişimi yeniden doğrular; kullanıcı artık üye değilse,
-- modül kapalıysa veya kayda erişimi kalmadıysa kayıt 'skipped' olur (push gitmez).
-- 5 dakikadan uzun 'sending' kalan kayıtlar (gönderici çöktü) yeniden denenir; 5 denemeden sonra 'failed'.
create function public.push_claim_batch(p_limit integer default 100)
returns table (
  outbox_id bigint,
  notification_id uuid,
  type text,
  entity_type text,
  entity_id uuid,
  data jsonb,
  tokens text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_outbox o
  set status = 'failed', last_error = coalesce(o.last_error, 'çok fazla deneme')
  where o.status in ('pending', 'sending') and o.attempts >= 5;

  update public.push_outbox o
  set status = 'skipped', last_error = 'erişim yok, modül kapalı veya etkin cihaz yok'
  from public.notifications n
  where n.id = o.notification_id
    and o.status in ('pending', 'sending')
    and (
      not private.user_is_member(o.user_id, o.company_id)
      or not private.module_enabled(n.company_id, n.module_id)
      or not private.user_can_access_entity(o.user_id, n.company_id, n.entity_type, n.entity_id)
      or not exists (select 1 from public.push_devices d where d.user_id = o.user_id and d.disabled_at is null)
    );

  return query
  with picked as (
    select o.id
    from public.push_outbox o
    where o.status = 'pending'
       or (o.status = 'sending' and o.claimed_at < now() - interval '5 minutes')
    order by o.created_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ),
  claimed as (
    update public.push_outbox o
    set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    from picked
    where o.id = picked.id
    returning o.id, o.notification_id, o.user_id
  )
  select c.id, c.notification_id, n.type, n.entity_type, n.entity_id, n.data,
         array(select d.expo_token from public.push_devices d where d.user_id = c.user_id and d.disabled_at is null order by d.created_at)
  from claimed c
  join public.notifications n on n.id = c.notification_id;
end;
$$;

-- Gönderim sonucu. Expo "DeviceNotRegistered" dediği token'lar devre dışı bırakılır.
create function public.push_complete(
  p_outbox_id bigint,
  p_status public.push_status,
  p_error text default null,
  p_tickets jsonb default null,
  p_invalid_tokens text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed', 'pending', 'skipped') then
    perform private.fail('invalid', 'Geçersiz push durumu.');
  end if;
  update public.push_outbox
  set status = p_status,
      last_error = left(p_error, 500),
      tickets = coalesce(p_tickets, tickets),
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_outbox_id;
  update public.push_devices
  set disabled_at = now(), disabled_reason = 'Expo: cihaz kayıtlı değil'
  where expo_token = any (coalesce(p_invalid_tokens, '{}')) and disabled_at is null;
end;
$$;

-- API yetkileri: gönderici fonksiyonları istemciye kapalı (yalnızca service_role).
create or replace function private.apply_api_grants()
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
  -- Yalnızca sunucu tarafı gönderici
  execute 'revoke execute on function public.push_claim_batch(integer) from authenticated';
  execute 'revoke execute on function public.push_complete(bigint, public.push_status, text, jsonb, text[]) from authenticated';
end;
$$;

select private.apply_api_grants();
