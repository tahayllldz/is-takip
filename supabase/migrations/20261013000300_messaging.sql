-- =====================================================================
-- İLETİŞİM MODÜLÜ (messaging)
-- Grup sohbetleri (grup üyeliğinden), birebir sohbetler, metin + fotoğraf/dosya
-- ekleri (özel Storage kovası), @etiketleme, okundu bilgisi, mesajdan göreve dönüştürme.
--
-- Erişim kuralları (docs/PERMISSIONS.md, docs/MODULES.md):
--  * Grup sohbeti: grubun aktif üyeleri. Gruptan çıkarılan kişi mesajları ve
--    dosyaları anında göremez (yöneticiler dahil; üyelik şart).
--  * Birebir sohbet: iki katılımcı. Şirketten çıkarılan kişinin erişimi kesilir.
--  * Dosyalar: storage.objects politikaları aynı fonksiyonları kullanır.
--  * Modül kapalıyken: yeni mesaj/bildirim yok. archive.view izni olan kişi yalnızca
--    KENDİSİNİN ÜYESİ OLDUĞU konuşmaları salt okunur görür; modülü kapatmak başkalarının
--    birebir veya grup mesajlarını açmaz.
--  * Tekrar güvenliği: mesajlar (author_id, client_request_id) ile tekildir; aynı mesajdan
--    en fazla bir görev oluşur (tasks.source_message_id unique).
-- =====================================================================

insert into public.modules (id, name, is_core, depends_on, sort_order)
values ('messaging', 'İletişim', false, '{}', 20);

insert into public.permissions (key, module_id, scope, label) values
  ('messages.direct',   'messaging', 'company', 'Birebir mesaj başlatma'),
  ('messages.moderate', 'messaging', 'group',   'Grup sohbetinde başkasının mesajını silme');

insert into public.role_permissions (role, permission) values
  ('owner', 'messages.direct'), ('owner', 'messages.moderate'),
  ('admin', 'messages.direct'), ('admin', 'messages.moderate'),
  ('employee', 'messages.direct');

insert into public.group_role_permissions (role, permission) values ('manager', 'messages.moderate');

-- Mevcut şirketlerde modül açık başlar
insert into public.company_modules (company_id, module_id, enabled)
select id, 'messaging', true from public.companies
on conflict do nothing;

create type public.conversation_kind as enum ('group', 'direct');

-- ---------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind public.conversation_kind not null,
  group_id uuid,
  -- Birebir sohbetin tekilliği: küçük-büyük sıralı iki kullanıcı kimliği
  direct_key text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (company_id, id),
  unique (group_id),
  unique (company_id, direct_key),
  foreign key (company_id, group_id) references public.groups (company_id, id) on delete cascade,
  constraint conversations_kind_check check (
    (kind = 'group' and group_id is not null and direct_key is null)
    or (kind = 'direct' and group_id is null and direct_key is not null)
  )
);

create index conversations_company_last_idx on public.conversations (company_id, last_message_at desc nulls last);

-- Yalnızca birebir sohbetler için (grup sohbetinde üyelik group_members'tan gelir)
create table public.conversation_participants (
  company_id uuid not null,
  conversation_id uuid not null,
  user_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  foreign key (company_id, conversation_id) references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members (company_id, user_id)
);

create index conversation_participants_user_idx on public.conversation_participants (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  conversation_id uuid not null,
  author_id uuid not null,
  body text not null default '' check (char_length(body) <= 4000),
  -- İstemcinin ürettiği tekrar-güvenlik anahtarı (yeniden bağlanma / tekrar gönderme tek mesaj üretir)
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id) on delete set null,
  unique (company_id, id),
  unique (author_id, client_request_id),
  foreign key (company_id, conversation_id) references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, author_id) references public.company_members (company_id, user_id),
  constraint messages_deleted_empty check (deleted_at is null or body = '')
);

create index messages_conversation_idx on public.messages (conversation_id, created_at desc);

create table public.message_mentions (
  message_id uuid not null,
  company_id uuid not null,
  conversation_id uuid not null,
  user_id uuid not null,
  primary key (message_id, user_id),
  foreign key (company_id, message_id) references public.messages (company_id, id) on delete cascade,
  foreign key (company_id, conversation_id) references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members (company_id, user_id)
);

create index message_mentions_user_idx on public.message_mentions (user_id, message_id);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  conversation_id uuid not null,
  message_id uuid not null,
  -- storage.objects.name: <şirket>/<konuşma>/<yükleme>/<dosya>
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  is_image boolean not null default false,
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, message_id) references public.messages (company_id, id) on delete cascade,
  foreign key (company_id, conversation_id) references public.conversations (company_id, id) on delete cascade
);

create index message_attachments_message_idx on public.message_attachments (message_id);

-- Kişi başına okundu bilgisi (okunmamış sayısı için)
create table public.conversation_reads (
  company_id uuid not null,
  conversation_id uuid not null,
  user_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  foreign key (company_id, conversation_id) references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members (company_id, user_id)
);

-- Mesajdan oluşturulan görev, kaynağına aynı şirket içinden bağlanır
alter table public.tasks
  add constraint tasks_source_message_fk foreign key (company_id, source_message_id)
  references public.messages (company_id, id) on delete set null (source_message_id);

-- Her grubun bir sohbeti vardır (grup oluşunca kendiliğinden)
create function private.groups_create_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conversations (company_id, kind, group_id, created_by)
  values (new.company_id, 'group', new.id, new.created_by)
  on conflict (group_id) do nothing;
  return new;
end;
$$;

create trigger groups_create_conversation after insert on public.groups
for each row execute function private.groups_create_conversation();

insert into public.conversations (company_id, kind, group_id, created_by)
select g.company_id, 'group', g.id, g.created_by from public.groups g
on conflict (group_id) do nothing;

-- =====================================================================
-- Yetki yardımcıları
-- =====================================================================

-- Konuşmanın üyesi mi (modül durumundan bağımsız). Şirketin aktif üyesi olmak şart.
create function private.user_in_conversation(p_user uuid, p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conv
      and private.user_is_member(p_user, c.company_id)
      and (
        (c.kind = 'group' and private.user_is_group_member(p_user, c.group_id))
        or (c.kind = 'direct' and exists (
          select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id = p_user
        ))
      )
  );
$$;

-- Okuma: modül açıkken konuşma üyeleri; kapalıyken yalnızca archive.view izni olan üye (salt okunur).
create function private.user_can_view_conversation(p_user uuid, p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conv
      and private.user_in_conversation(p_user, c.id)
      and (
        private.module_enabled(c.company_id, 'messaging')
        or private.user_has_perm(p_user, c.company_id, 'archive.view')
      )
  );
$$;

create function private.user_can_view_message(p_user uuid, p_message uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.user_can_view_conversation(p_user, m.conversation_id) from public.messages m where m.id = p_message),
    false
  );
$$;

-- Yazmayı engelleyen durum (null = engel yok): arşivlenmiş grup, şirketten ayrılmış karşı taraf.
create function private.conversation_post_block(p_user uuid, p_conv public.conversations)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_conv.kind = 'group'
         and exists (select 1 from public.groups g where g.id = p_conv.group_id and g.archived_at is not null)
      then 'Bu grup arşivlenmiş; yeni mesaj gönderilemez.'
    when p_conv.kind = 'direct'
         and exists (
           select 1 from public.conversation_participants p
           where p.conversation_id = p_conv.id and p.user_id <> p_user
             and not private.user_is_member(p.user_id, p_conv.company_id)
         )
      then 'Bu kişi artık şirkette değil; yeni mesaj gönderilemez.'
    else null
  end;
$$;

create function private.user_can_post_conversation(p_user uuid, p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conv
      and private.module_enabled(c.company_id, 'messaging')
      and private.user_in_conversation(p_user, c.id)
      and private.conversation_post_block(p_user, c) is null
  );
$$;

-- Bildirim erişim kontrolüne mesaj ve konuşma türlerini ekle
create or replace function private.user_can_access_entity(p_user uuid, p_company uuid, p_entity_type text, p_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_entity_type
    when 'company' then private.user_is_member(p_user, p_company)
    when 'group' then private.user_can_see_group(p_user, p_entity_id)
    when 'task' then private.user_can_view_task(p_user, p_entity_id)
    when 'message' then private.user_can_view_message(p_user, p_entity_id)
    when 'conversation' then private.user_can_view_conversation(p_user, p_entity_id)
    else false
  end;
$$;

-- ---------------------------------------------------------------------
-- Ek dosyaları (Storage). Yol biçimi: <şirket>/<konuşma>/<yükleme-uuid>/<dosya-adı>
-- ---------------------------------------------------------------------
create function private.attachment_path_conversation(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]{1,200}$' then
    return null;
  end if;
  return split_part(p_name, '/', 2)::uuid;
end;
$$;

create function private.attachment_is_linked(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.message_attachments a where a.storage_path = p_name);
$$;

-- Yükleme: kişi bu konuşmaya yazabiliyorsa ve yol konuşmanın şirketiyle uyumluysa
create function private.can_upload_message_attachment(p_user uuid, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = private.attachment_path_conversation(p_name)
      and c.company_id::text = split_part(p_name, '/', 1)
      and private.user_can_post_conversation(p_user, c.id)
  );
$$;

-- Okuma: silinmemiş bir mesaja bağlı ve konuşmayı görebiliyor; ya da henüz gönderilmemiş kendi yüklemesi
create function private.can_read_message_attachment(p_user uuid, p_name text, p_owner text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.message_attachments a
      join public.messages m on m.id = a.message_id
      where a.storage_path = p_name
        and m.deleted_at is null
        and private.user_can_view_conversation(p_user, a.conversation_id)
    )
    or (
      p_owner = p_user::text
      and not private.attachment_is_linked(p_name)
      and private.can_upload_message_attachment(p_user, p_name)
    );
$$;

-- Özel kova: herkese açık bağlantı yok; erişim yalnızca RLS + kısa süreli imzalı bağlantı
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments', 'message-attachments', false, 10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;

create policy message_attachments_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-attachments'
  and private.can_upload_message_attachment((select auth.uid()), name)
);

create policy message_attachments_download on storage.objects for select to authenticated
using (
  bucket_id = 'message-attachments'
  and private.can_read_message_attachment((select auth.uid()), name, coalesce(owner_id, owner::text))
);

-- Gönderilmeden vazgeçilen kendi yüklemesini silebilir (mesaja bağlanmış dosya silinemez)
create policy message_attachments_delete_pending on storage.objects for delete to authenticated
using (
  bucket_id = 'message-attachments'
  and coalesce(owner_id, owner::text) = (select auth.uid())::text
  and not private.attachment_is_linked(name)
);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_mentions enable row level security;
alter table public.message_attachments enable row level security;
alter table public.conversation_reads enable row level security;

create policy conversations_read on public.conversations for select to authenticated
using (private.user_can_view_conversation((select auth.uid()), id));

create policy conversation_participants_read on public.conversation_participants for select to authenticated
using (private.user_can_view_conversation((select auth.uid()), conversation_id));

create policy messages_read on public.messages for select to authenticated
using (private.user_can_view_conversation((select auth.uid()), conversation_id));

create policy message_mentions_read on public.message_mentions for select to authenticated
using (private.user_can_view_conversation((select auth.uid()), conversation_id));

create policy message_attachments_read on public.message_attachments for select to authenticated
using (private.user_can_view_conversation((select auth.uid()), conversation_id));

create policy conversation_reads_read on public.conversation_reads for select to authenticated
using (user_id = (select auth.uid()) and private.user_can_view_conversation((select auth.uid()), conversation_id));

-- =====================================================================
-- Listeleme (SECURITY INVOKER: yalnızca çağıranın görebildiği satırlar)
-- =====================================================================

-- Sohbet listesi: başlık, son mesaj, okunmamış sayısı, yazılabilir mi
create function public.conversation_list(p_company uuid)
returns table (
  id uuid,
  kind public.conversation_kind,
  group_id uuid,
  title text,
  other_user_id uuid,
  last_message_at timestamptz,
  last_message_body text,
  last_message_author uuid,
  last_message_deleted boolean,
  last_message_has_files boolean,
  unread_count bigint,
  can_post boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id,
         c.kind,
         c.group_id,
         case when c.kind = 'group' then g.name else coalesce(nullif(op.full_name, ''), op.email, 'Kişi') end,
         o.user_id,
         c.last_message_at,
         lm.body,
         lm.author_id,
         lm.deleted_at is not null,
         coalesce(lm.has_files, false),
         (select count(*) from public.messages m
           where m.conversation_id = c.id
             and m.deleted_at is null
             and m.author_id <> (select auth.uid())
             and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
         private.user_can_post_conversation((select auth.uid()), c.id)
  from public.conversations c
  left join public.groups g on g.id = c.group_id
  left join lateral (
    select p.user_id from public.conversation_participants p
    where p.conversation_id = c.id and p.user_id <> (select auth.uid())
    limit 1
  ) o on true
  left join public.profiles op on op.id = o.user_id
  left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = (select auth.uid())
  left join lateral (
    select m.body, m.author_id, m.deleted_at,
           exists (select 1 from public.message_attachments a where a.message_id = m.id) as has_files
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where c.company_id = p_company
    and (c.kind = 'direct' or g.archived_at is null or c.last_message_at is not null)
  order by c.last_message_at desc nulls last, 4;
$$;

-- Etiketlendiğim mesajlar (ana sayfa bileşeni)
create function public.my_mentions(p_company uuid, p_limit integer default 10)
returns table (
  message_id uuid,
  conversation_id uuid,
  conversation_title text,
  author_id uuid,
  body text,
  created_at timestamptz,
  is_read boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id,
         m.conversation_id,
         case when c.kind = 'group' then g.name else 'Birebir mesaj' end,
         m.author_id,
         m.body,
         m.created_at,
         m.created_at <= coalesce(r.last_read_at, '-infinity'::timestamptz)
  from public.message_mentions mm
  join public.messages m on m.id = mm.message_id
  join public.conversations c on c.id = m.conversation_id
  left join public.groups g on g.id = c.group_id
  left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = (select auth.uid())
  where mm.user_id = (select auth.uid())
    and mm.company_id = p_company
    and m.deleted_at is null
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- =====================================================================
-- RPC fonksiyonları
-- =====================================================================

-- Birebir sohbet: varsa onu döndürür, yoksa oluşturur (tekrar çağrı güvenli).
create function public.get_or_create_direct_conversation(p_company uuid, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_key text;
  v_conv uuid;
begin
  perform private.require_member(p_company);
  perform private.require_module(p_company, 'messaging');
  if p_user is null or p_user = v_uid then
    perform private.fail('invalid', 'Kendinize mesaj gönderemezsiniz.');
  end if;
  if not private.user_is_member(p_user, p_company) then
    perform private.fail('invalid', 'Bu kişi şirketin aktif üyesi değil.');
  end if;
  v_key := least(v_uid::text, p_user::text) || ':' || greatest(v_uid::text, p_user::text);

  select id into v_conv from public.conversations where company_id = p_company and direct_key = v_key;
  if found then
    return v_conv;
  end if;

  perform private.require_perm(p_company, 'messages.direct');
  insert into public.conversations (company_id, kind, direct_key, created_by)
  values (p_company, 'direct', v_key, v_uid)
  on conflict (company_id, direct_key) do nothing
  returning id into v_conv;
  if v_conv is null then
    -- Eşzamanlı aynı istek: diğerinin oluşturduğunu döndür
    select id into v_conv from public.conversations where company_id = p_company and direct_key = v_key;
    return v_conv;
  end if;

  insert into public.conversation_participants (company_id, conversation_id, user_id)
  values (p_company, v_conv, v_uid), (p_company, v_conv, p_user);
  return v_conv;
end;
$$;

-- Mesaj gönderme. p_attachments: [{ "path": "<storage yolu>", "name": "<görünen ad>" }]
-- Ekler önce istemcide kullanıcının kendi oturumuyla özel kovaya yüklenir (RLS),
-- sonra burada yalnızca bu kişinin bu konuşmaya yüklediği ve henüz bağlanmamış dosyalar kabul edilir.
-- Boyut ve tür istemciden değil Storage kaydından alınır.
create function public.send_message(
  p_conversation uuid,
  p_body text,
  p_client_request_id uuid,
  p_mentions uuid[] default '{}',
  p_attachments jsonb default '[]'::jsonb
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_conv public.conversations;
  v_msg public.messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_atts jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_mentions uuid[];
  v_block text;
  v_path text;
  v_author text;
  v_preview text;
  a jsonb;
  u uuid;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if not found or not private.user_can_view_conversation(v_uid, p_conversation) then
    perform private.fail('not_found', 'Konuşma bulunamadı.');
  end if;
  perform private.require_module(v_conv.company_id, 'messaging');
  if p_client_request_id is null then
    perform private.fail('invalid', 'İstek kimliği eksik.');
  end if;

  -- Tekrar deneme (yeniden bağlanma, çift dokunma): aynı istek kimliğiyle gönderilmiş mesajı döndür
  select * into v_msg from public.messages where author_id = v_uid and client_request_id = p_client_request_id;
  if found then
    return v_msg;
  end if;

  v_block := private.conversation_post_block(v_uid, v_conv);
  if v_block is not null then
    perform private.fail('forbidden', v_block);
  end if;
  if jsonb_typeof(v_atts) <> 'array' then
    perform private.fail('invalid', 'Ek listesi geçersiz.');
  end if;
  if char_length(v_body) > 4000 then
    perform private.fail('invalid', 'Mesaj en fazla 4000 karakter olabilir.');
  end if;
  if jsonb_array_length(v_atts) > 10 then
    perform private.fail('invalid', 'Bir mesaja en fazla 10 dosya eklenebilir.');
  end if;
  if v_body = '' and jsonb_array_length(v_atts) = 0 then
    perform private.fail('invalid', 'Boş mesaj gönderilemez.');
  end if;

  -- @etiket yalnızca bu konuşmanın üyelerine (etiketlemek görev atamak değildir)
  v_mentions := array(select distinct x from unnest(coalesce(p_mentions, '{}')) x where x is not null and x <> v_uid);
  if cardinality(v_mentions) > 50 then
    perform private.fail('invalid', 'Bir mesajda en fazla 50 kişi etiketlenebilir.');
  end if;
  if exists (select 1 from unnest(v_mentions) x where not private.user_in_conversation(x, p_conversation)) then
    perform private.fail('invalid', 'Etiketlediğiniz kişilerden biri bu konuşmada değil.');
  end if;

  if (select count(distinct e.value ->> 'path') from jsonb_array_elements(v_atts) e) <> jsonb_array_length(v_atts) then
    perform private.fail('invalid', 'Aynı dosya iki kez eklenmiş.');
  end if;
  for a in select e.value from jsonb_array_elements(v_atts) e loop
    v_path := a ->> 'path';
    if private.attachment_path_conversation(v_path) is distinct from p_conversation
       or split_part(v_path, '/', 1) <> v_conv.company_id::text
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'message-attachments' and o.name = v_path
           and coalesce(o.owner_id, o.owner::text) = v_uid::text
       )
       or private.attachment_is_linked(v_path) then
      perform private.fail('invalid', 'Ek dosya bulunamadı veya size ait değil. Dosyayı yeniden ekleyin.');
    end if;
  end loop;

  insert into public.messages (company_id, conversation_id, author_id, body, client_request_id)
  values (v_conv.company_id, p_conversation, v_uid, v_body, p_client_request_id)
  on conflict (author_id, client_request_id) do nothing
  returning * into v_msg;
  if v_msg.id is null then
    -- Eşzamanlı aynı istek: diğerinin oluşturduğunu döndür
    select * into v_msg from public.messages where author_id = v_uid and client_request_id = p_client_request_id;
    return v_msg;
  end if;

  insert into public.message_mentions (message_id, company_id, conversation_id, user_id)
  select v_msg.id, v_conv.company_id, p_conversation, x from unnest(v_mentions) x;

  insert into public.message_attachments (
    company_id, conversation_id, message_id, storage_path, file_name, mime_type, size_bytes, is_image, uploaded_by
  )
  select v_conv.company_id, p_conversation, v_msg.id, o.name,
         left(coalesce(nullif(btrim(replace(e.value ->> 'name', '/', '_')), ''), split_part(o.name, '/', 4)), 200),
         coalesce(nullif(o.metadata ->> 'mimetype', ''), 'application/octet-stream'),
         coalesce((o.metadata ->> 'size')::bigint, 0),
         coalesce(o.metadata ->> 'mimetype', '') like 'image/%',
         v_uid
  from jsonb_array_elements(v_atts) e
  join storage.objects o on o.bucket_id = 'message-attachments' and o.name = e.value ->> 'path';

  update public.conversations set last_message_at = v_msg.created_at where id = p_conversation;
  insert into public.conversation_reads (company_id, conversation_id, user_id, last_read_at)
  values (v_conv.company_id, p_conversation, v_uid, v_msg.created_at)
  on conflict (conversation_id, user_id)
  do update set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at);

  v_author := private.display_name(v_uid);
  v_preview := case when v_body = '' then 'Dosya gönderdi' else left(v_body, 140) end;
  foreach u in array v_mentions loop
    perform private.notify(v_conv.company_id, u, 'messaging', 'message_mention', 'message', v_msg.id,
      v_author || ' sizi bir mesajda etiketledi', v_preview, 'mm:' || v_msg.id,
      jsonb_build_object('conversation_id', p_conversation));
  end loop;

  return v_msg;
end;
$$;

-- Mesaj silme (içerik temizlenir, kayıt kalır). Yazarı veya grup sohbetinde messages.moderate izni olan.
-- Silinen mesajın ekleri artık indirilemez; etiket bildirimleri kaldırılır.
create function public.delete_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_msg public.messages;
  v_conv public.conversations;
begin
  select * into v_msg from public.messages where id = p_message for update;
  if not found or not private.user_can_view_conversation(v_uid, v_msg.conversation_id) then
    perform private.fail('not_found', 'Mesaj bulunamadı.');
  end if;
  perform private.require_module(v_msg.company_id, 'messaging');
  if v_msg.deleted_at is not null then
    return;
  end if;
  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if v_msg.author_id <> v_uid
     and not (v_conv.kind = 'group' and private.has_perm(v_msg.company_id, 'messages.moderate', v_conv.group_id)) then
    perform private.fail('forbidden', 'Yalnızca kendi mesajınızı silebilirsiniz.');
  end if;

  update public.messages set body = '', deleted_at = now(), deleted_by = v_uid where id = p_message;
  delete from public.notifications where dedupe_key = 'mm:' || p_message;
  if v_msg.author_id <> v_uid then
    perform private.audit(v_msg.company_id, 'message.deleted_by_moderator', 'message', p_message,
      jsonb_build_object('conversation_id', v_msg.conversation_id, 'author_id', v_msg.author_id));
  end if;
end;
$$;

-- Konuşma okundu; bu konuşmadaki etiket bildirimleri de okundu sayılır.
create function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_conv public.conversations;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if not found or not private.user_can_view_conversation(v_uid, p_conversation) then
    perform private.fail('not_found', 'Konuşma bulunamadı.');
  end if;
  insert into public.conversation_reads (company_id, conversation_id, user_id, last_read_at)
  values (v_conv.company_id, p_conversation, v_uid, now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at);

  update public.notifications
  set read_at = now()
  where user_id = v_uid and read_at is null and type = 'message_mention'
    and data ->> 'conversation_id' = p_conversation::text;
end;
$$;

-- Mesajdan göreve dönüştür (İletişim + Görevler açık olmalı).
-- Bir mesajdan tek görev: tekrar çağrı (aynı veya farklı kişi) mevcut görevi döndürür.
-- Grup sohbetindeki mesajdan oluşan görev o gruba bağlanır.
create function public.create_task_from_message(
  p_message uuid,
  p_title text,
  p_assignee uuid,
  p_client_request_id uuid,
  p_description text default null,
  p_due_date date default null,
  p_due_time time default null,
  p_priority public.task_priority default 'normal'
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_msg public.messages;
  v_conv public.conversations;
  v_task public.tasks;
begin
  select * into v_msg from public.messages where id = p_message;
  if not found or not private.user_can_view_conversation(v_uid, v_msg.conversation_id) then
    perform private.fail('not_found', 'Mesaj bulunamadı.');
  end if;
  perform private.require_module(v_msg.company_id, 'messaging');
  perform private.require_module(v_msg.company_id, 'tasks');

  select * into v_task from public.tasks where source_message_id = p_message;
  if found then
    if private.user_can_view_task(v_uid, v_task.id) then
      return v_task;
    end if;
    perform private.fail('conflict', 'Bu mesaj zaten göreve dönüştürülmüş.');
  end if;
  if v_msg.deleted_at is not null then
    perform private.fail('invalid', 'Silinmiş mesaj göreve dönüştürülemez.');
  end if;

  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  begin
    v_task := private.create_task_internal(
      v_msg.company_id, p_title, p_assignee, p_client_request_id,
      coalesce(p_description, v_msg.body), '{}', p_due_date, p_due_time, p_priority,
      case when v_conv.kind = 'group' then v_conv.group_id end,
      p_message
    );
  exception when unique_violation then
    -- Eşzamanlı dönüştürme: diğerinin oluşturduğu görevi döndür
    select * into v_task from public.tasks where source_message_id = p_message;
    if not found or not private.user_can_view_task(v_uid, v_task.id) then
      perform private.fail('conflict', 'Bu mesaj zaten göreve dönüştürülmüş.');
    end if;
    return v_task;
  end;

  -- Tekrar deneme: create_task_internal aynı istekle oluşturulmuş görevi döndürmüş olabilir
  if v_task.source_message_id is distinct from p_message then
    perform private.fail('conflict', 'Bu istek kimliği başka bir görev için kullanılmış.');
  end if;

  if v_msg.author_id <> v_uid then
    perform private.notify(v_msg.company_id, v_msg.author_id, 'tasks', 'message_converted', 'task', v_task.id,
      private.display_name(v_uid) || ' mesajınızı göreve dönüştürdü', v_task.title, 'mt:' || v_task.id);
  end if;
  return v_task;
end;
$$;

-- =====================================================================
-- Realtime (olay yalnızca "yenile" sinyali; RLS aboneye göre uygulanır)
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

select private.apply_api_grants();
