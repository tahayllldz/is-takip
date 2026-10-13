-- =====================================================================
-- GÖREVLER MODÜLÜ (tasks)
-- Görev: başlık, açıklama, tek ana sorumlu, isteğe bağlı katkıda bulunanlar,
-- son tarih, öncelik, isteğe bağlı grup bağlantısı, durum (Yeni / Devam ediyor /
-- Beklemede / Tamamlandı), beklemede nedeni, yorumlar ve @etiketleme, işlem geçmişi.
--
-- Bildirildi / Görüldü / Üstlenildi / Tamamlandı ayrı zaman damgalarıdır:
--   notified_at  : sorumluya atama bildirimi üretildi
--   seen_at      : sorumlu görevi ilk kez açtı
--   accepted_at  : sorumlu "Üstlendim" dedi (veya işe başladı)
--   completed_at : durum Tamamlandı
-- Gecikme = son tarih geçmiş ve durum Tamamlandı değil (public.is_overdue).
-- Son tarih şirket saat diliminde (companies.timezone) hesaplanır, UTC saklanır.
-- =====================================================================

insert into public.modules (id, name, is_core, depends_on, sort_order)
values ('tasks', 'Görevler', false, '{}', 10);

insert into public.permissions (key, module_id, scope, label) values
  ('tasks.create',     'tasks', 'company', 'Kendine görev oluşturma'),
  ('tasks.assign',     'tasks', 'group',   'Başkasına görev atama'),
  ('tasks.view_all',   'tasks', 'group',   'Kapsamdaki tüm görevleri görme'),
  ('tasks.manage_all', 'tasks', 'group',   'Kapsamdaki görevleri düzenleme ve yeniden atama');

insert into public.role_permissions (role, permission) values
  ('owner', 'tasks.create'), ('owner', 'tasks.assign'), ('owner', 'tasks.view_all'), ('owner', 'tasks.manage_all'),
  ('admin', 'tasks.create'), ('admin', 'tasks.assign'), ('admin', 'tasks.view_all'), ('admin', 'tasks.manage_all'),
  ('employee', 'tasks.create');

-- Mevcut şirketlerde modül açık başlar
insert into public.company_modules (company_id, module_id, enabled)
select id, 'tasks', true from public.companies
on conflict do nothing;

create type public.task_status as enum ('new', 'in_progress', 'on_hold', 'done');
create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  status public.task_status not null default 'new',
  hold_reason text check (hold_reason is null or char_length(hold_reason) between 1 and 300),
  priority public.task_priority not null default 'normal',
  assignee_id uuid not null,
  created_by uuid not null,
  group_id uuid,
  due_at timestamptz,
  due_all_day boolean not null default false,
  -- Mesajdan oluşturulan görevin kaynağı (İletişim modülü FK'yi ekler). Bir mesajdan tek görev.
  source_message_id uuid unique,
  -- İstemcinin ürettiği tekrar-güvenlik anahtarı (aynı istek iki kez gelirse tek kayıt)
  client_request_id uuid not null,
  notified_at timestamptz,
  seen_at timestamptz,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (created_by, client_request_id),
  constraint tasks_assignee_fk foreign key (company_id, assignee_id) references public.company_members (company_id, user_id),
  constraint tasks_creator_fk foreign key (company_id, created_by) references public.company_members (company_id, user_id),
  constraint tasks_group_fk foreign key (company_id, group_id) references public.groups (company_id, id) on delete set null (group_id),
  constraint tasks_hold_reason_required check (status <> 'on_hold' or hold_reason is not null),
  constraint tasks_completed_consistent check ((status = 'done') = (completed_at is not null))
);

create index tasks_assignee_idx on public.tasks (company_id, assignee_id, status);
create index tasks_creator_idx on public.tasks (company_id, created_by, status);
create index tasks_group_idx on public.tasks (company_id, group_id) where group_id is not null;
create index tasks_open_due_idx on public.tasks (company_id, due_at) where status <> 'done';

create function private.tasks_before_update()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$$;

create trigger tasks_before_update before update on public.tasks
for each row execute function private.tasks_before_update();

create table public.task_contributors (
  company_id uuid not null,
  task_id uuid not null,
  user_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (task_id, user_id),
  foreign key (company_id, task_id) references public.tasks (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members (company_id, user_id)
);

create index task_contributors_user_idx on public.task_contributors (user_id);

create table public.task_events (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  task_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (company_id, task_id) references public.tasks (company_id, id) on delete cascade
);

create index task_events_task_idx on public.task_events (task_id, created_at);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  task_id uuid not null,
  author_id uuid not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (author_id, client_request_id),
  foreign key (company_id, task_id) references public.tasks (company_id, id) on delete cascade,
  foreign key (company_id, author_id) references public.company_members (company_id, user_id)
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_comment_mentions (
  comment_id uuid not null references public.task_comments (id) on delete cascade,
  company_id uuid not null,
  task_id uuid not null,
  user_id uuid not null,
  primary key (comment_id, user_id),
  foreign key (company_id, task_id) references public.tasks (company_id, id) on delete cascade,
  foreign key (company_id, user_id) references public.company_members (company_id, user_id)
);

create index task_comment_mentions_user_idx on public.task_comment_mentions (user_id);

-- =====================================================================
-- Yetki yardımcıları
-- =====================================================================

-- Görev görünürlüğü:
--  modül açıkken: sorumlu, görevi veren, katkıda bulunan, bağlı grubun üyesi,
--                 kapsamında tasks.view_all olan;
--  modül kapalıyken: yalnızca archive.view izni olan (salt okunur arşiv).
create function private.user_can_view_task_row(p_user uuid, p_company uuid, p_task uuid, p_assignee uuid, p_creator uuid, p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_is_member(p_user, p_company)
    and (
      (
        private.module_enabled(p_company, 'tasks')
        and (
          p_assignee = p_user
          or p_creator = p_user
          or exists (select 1 from public.task_contributors c where c.task_id = p_task and c.user_id = p_user)
          or (p_group is not null and private.user_is_group_member(p_user, p_group))
          or private.user_has_perm(p_user, p_company, 'tasks.view_all', p_group)
        )
      )
      or (
        not private.module_enabled(p_company, 'tasks')
        and private.user_has_perm(p_user, p_company, 'archive.view')
      )
    );
$$;

create function private.user_can_view_task(p_user uuid, p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.user_can_view_task_row(p_user, t.company_id, t.id, t.assignee_id, t.created_by, t.group_id)
     from public.tasks t where t.id = p_task),
    false
  );
$$;

-- Görevi düzenleme/yeniden atama: görevi veren veya kapsamında tasks.manage_all olan.
create function private.user_can_manage_task(p_user uuid, p_task public.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_is_member(p_user, p_task.company_id)
    and (p_task.created_by = p_user or private.user_has_perm(p_user, p_task.company_id, 'tasks.manage_all', p_task.group_id));
$$;

-- Bildirim erişim kontrolüne 'task' türünü ekle
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
    else false
  end;
$$;

create function private.task_status_label(p_status public.task_status)
returns text
language sql
immutable
as $$
  select case p_status
    when 'new' then 'Yeni'
    when 'in_progress' then 'Devam ediyor'
    when 'on_hold' then 'Beklemede'
    when 'done' then 'Tamamlandı'
  end;
$$;

-- Son tarih: şirket saat dilimindeki gün (+ isteğe bağlı saat) → UTC an.
-- Saat verilmezse gün sonu (23:59:59) kabul edilir ve due_all_day = true olur.
create function private.task_due_at(p_company uuid, p_date date, p_time time)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_date is null then null
    else ((p_date + coalesce(p_time, time '23:59:59')) at time zone c.timezone)
  end
  from public.companies c
  where c.id = p_company;
$$;

-- Atama yetkisi: kendine atamak herkese açık (tasks.create); başkasına atamak
-- tasks.assign ister. Grup kapsamlı yönetici yalnızca kapsam grubunun üyelerine atayabilir.
create function private.assert_can_assign(p_company uuid, p_group uuid, p_users uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_others uuid[];
begin
  perform private.assert_active_members(p_company, p_users);
  v_others := array(select x from unnest(coalesce(p_users, '{}')) x where x <> v_uid);
  if cardinality(v_others) = 0 then
    return;
  end if;
  if not private.has_perm(p_company, 'tasks.assign', p_group) then
    perform private.fail('forbidden', 'Başkasına görev atama yetkiniz yok.');
  end if;
  if not private.has_perm(p_company, 'tasks.assign', null)
     and exists (select 1 from unnest(v_others) x where not private.user_is_group_member(x, p_group)) then
    perform private.fail('forbidden', 'Yalnızca yetkili olduğunuz grubun üyelerine görev atayabilirsiniz.');
  end if;
end;
$$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.tasks enable row level security;
alter table public.task_contributors enable row level security;
alter table public.task_events enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_comment_mentions enable row level security;

create policy tasks_read on public.tasks for select to authenticated
using (private.user_can_view_task_row((select auth.uid()), company_id, id, assignee_id, created_by, group_id));

create policy task_contributors_read on public.task_contributors for select to authenticated
using (private.user_can_view_task((select auth.uid()), task_id));

create policy task_events_read on public.task_events for select to authenticated
using (private.user_can_view_task((select auth.uid()), task_id));

create policy task_comments_read on public.task_comments for select to authenticated
using (private.user_can_view_task((select auth.uid()), task_id));

create policy task_comment_mentions_read on public.task_comment_mentions for select to authenticated
using (private.user_can_view_task((select auth.uid()), task_id));

-- =====================================================================
-- Hesaplanan alan ve özet
-- =====================================================================

-- PostgREST hesaplanan sütunu: select=*,is_overdue
create function public.is_overdue(t public.tasks)
returns boolean
language sql
stable
as $$
  select t.status <> 'done' and t.due_at is not null and t.due_at < now();
$$;

-- Ekip görev özeti: SECURITY INVOKER — yalnızca çağıranın görebildiği görevler sayılır.
create function public.task_summary(p_company uuid, p_group uuid default null)
returns table (status public.task_status, total bigint, overdue bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.status,
         count(*)::bigint,
         count(*) filter (where t.status <> 'done' and t.due_at is not null and t.due_at < now())::bigint
  from public.tasks t
  where t.company_id = p_company and (p_group is null or t.group_id = p_group)
  group by t.status;
$$;

-- =====================================================================
-- RPC fonksiyonları
-- =====================================================================

create function private.create_task_internal(
  p_company uuid,
  p_title text,
  p_assignee uuid,
  p_client_request_id uuid,
  p_description text,
  p_contributors uuid[],
  p_due_date date,
  p_due_time time,
  p_priority public.task_priority,
  p_group uuid,
  p_source_message uuid
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_task public.tasks;
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_contribs uuid[];
  v_event bigint;
  c uuid;
begin
  perform private.require_member(p_company);
  perform private.require_module(p_company, 'tasks');
  if p_client_request_id is null then
    perform private.fail('invalid', 'İstek kimliği eksik.');
  end if;

  -- Tekrar deneme: aynı istek kimliğiyle oluşturulmuş görev varsa onu döndür.
  select * into v_task from public.tasks where created_by = v_uid and client_request_id = p_client_request_id;
  if found then
    return v_task;
  end if;

  perform private.require_perm(p_company, 'tasks.create');
  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    perform private.fail('invalid', 'Görev başlığı 1-200 karakter olmalı.');
  end if;
  if char_length(v_desc) > 5000 then
    perform private.fail('invalid', 'Açıklama en fazla 5000 karakter olabilir.');
  end if;
  if p_due_time is not null and p_due_date is null then
    perform private.fail('invalid', 'Saat seçtiyseniz tarih de seçin.');
  end if;
  if p_group is not null then
    if not exists (select 1 from public.groups g where g.id = p_group and g.company_id = p_company and g.archived_at is null) then
      perform private.fail('invalid', 'Grup bulunamadı.');
    end if;
    if not private.user_can_see_group(v_uid, p_group) then
      perform private.fail('forbidden', 'Bu gruba görev bağlayamazsınız.');
    end if;
  end if;

  v_contribs := array(select distinct x from unnest(coalesce(p_contributors, '{}')) x where x is not null and x <> p_assignee);
  if cardinality(v_contribs) > 20 then
    perform private.fail('invalid', 'En fazla 20 katkıda bulunan eklenebilir.');
  end if;
  perform private.assert_can_assign(p_company, p_group, array[p_assignee] || v_contribs);

  insert into public.tasks (
    company_id, title, description, priority, assignee_id, created_by, group_id,
    due_at, due_all_day, source_message_id, client_request_id
  )
  values (
    p_company, v_title, v_desc, coalesce(p_priority, 'normal'), p_assignee, v_uid, p_group,
    private.task_due_at(p_company, p_due_date, p_due_time), p_due_date is not null and p_due_time is null,
    p_source_message, p_client_request_id
  )
  on conflict (created_by, client_request_id) do nothing
  returning * into v_task;

  if v_task.id is null then
    -- Eşzamanlı aynı istek: diğerinin oluşturduğu kaydı döndür
    select * into v_task from public.tasks where created_by = v_uid and client_request_id = p_client_request_id;
    return v_task;
  end if;

  insert into public.task_contributors (company_id, task_id, user_id)
  select p_company, v_task.id, x from unnest(v_contribs) x;

  insert into public.task_events (company_id, task_id, actor_id, type, data)
  values (p_company, v_task.id, v_uid, 'created', jsonb_build_object(
    'assignee_id', p_assignee, 'contributors', to_jsonb(v_contribs), 'source_message_id', p_source_message))
  returning id into v_event;

  if private.notify(p_company, p_assignee, 'tasks', 'task_assigned', 'task', v_task.id,
       'Size yeni görev verildi', v_title, 'te:' || v_event,
       jsonb_build_object('by', private.display_name(v_uid))) then
    update public.tasks set notified_at = now() where id = v_task.id returning * into v_task;
  end if;

  foreach c in array v_contribs loop
    perform private.notify(p_company, c, 'tasks', 'task_contributor_added', 'task', v_task.id,
      'Bir göreve katkıda bulunan olarak eklendiniz', v_title, 'te:' || v_event);
  end loop;

  return v_task;
end;
$$;

create function public.create_task(
  p_company uuid,
  p_title text,
  p_assignee uuid,
  p_client_request_id uuid,
  p_description text default '',
  p_contributors uuid[] default '{}',
  p_due_date date default null,
  p_due_time time default null,
  p_priority public.task_priority default 'normal',
  p_group uuid default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.create_task_internal(
    p_company, p_title, p_assignee, p_client_request_id, p_description, p_contributors,
    p_due_date, p_due_time, p_priority, p_group, null
  );
end;
$$;

-- Görev düzenleme. p_changes içinde yalnızca değişecek alanlar bulunur:
--   title, description, priority, assignee_id, group_id, contributor_ids,
--   due_date ('YYYY-MM-DD' | null), due_time ('HH:MM' | null)
create function public.update_task(p_task uuid, p_changes jsonb, p_expected_version integer default null)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_old public.tasks;
  v_new public.tasks;
  v_title text;
  v_desc text;
  v_priority public.task_priority;
  v_assignee uuid;
  v_group uuid;
  v_due_at timestamptz;
  v_all_day boolean;
  v_contribs uuid[];
  v_old_contribs uuid[];
  v_changed text[] := '{}';
  v_event bigint;
  v_date date;
  v_time time;
  c uuid;
begin
  select * into v_old from public.tasks where id = p_task for update;
  if not found or not private.user_can_view_task(v_uid, p_task) then
    perform private.fail('not_found', 'Görev bulunamadı.');
  end if;
  perform private.require_module(v_old.company_id, 'tasks');
  if not private.user_can_manage_task(v_uid, v_old) then
    perform private.fail('forbidden', 'Bu görevi düzenleme yetkiniz yok.');
  end if;
  if p_expected_version is not null and v_old.version <> p_expected_version then
    perform private.fail('conflict', 'Görev siz bakarken güncellendi. Yenileyip tekrar deneyin.');
  end if;

  v_title := case when p_changes ? 'title' then btrim(coalesce(p_changes ->> 'title', '')) else v_old.title end;
  v_desc := case when p_changes ? 'description' then btrim(coalesce(p_changes ->> 'description', '')) else v_old.description end;
  v_priority := case when p_changes ? 'priority' then (p_changes ->> 'priority')::public.task_priority else v_old.priority end;
  v_assignee := case when p_changes ? 'assignee_id' then (p_changes ->> 'assignee_id')::uuid else v_old.assignee_id end;
  v_group := case when p_changes ? 'group_id' then nullif(p_changes ->> 'group_id', '')::uuid else v_old.group_id end;

  if char_length(v_title) < 1 or char_length(v_title) > 200 then
    perform private.fail('invalid', 'Görev başlığı 1-200 karakter olmalı.');
  end if;
  if char_length(v_desc) > 5000 then
    perform private.fail('invalid', 'Açıklama en fazla 5000 karakter olabilir.');
  end if;
  if v_assignee is null then
    perform private.fail('invalid', 'Görevin bir ana sorumlusu olmalı.');
  end if;

  if v_group is distinct from v_old.group_id then
    if v_group is not null then
      if not exists (select 1 from public.groups g where g.id = v_group and g.company_id = v_old.company_id and g.archived_at is null) then
        perform private.fail('invalid', 'Grup bulunamadı.');
      end if;
      if not private.user_can_see_group(v_uid, v_group) then
        perform private.fail('forbidden', 'Bu gruba görev bağlayamazsınız.');
      end if;
    end if;
    -- Kısıtlı yönetici görevi kapsamı dışına taşıyamaz
    if v_old.created_by <> v_uid and not private.has_perm(v_old.company_id, 'tasks.manage_all', v_group) then
      perform private.fail('forbidden', 'Görevi bu gruba taşıma yetkiniz yok.');
    end if;
    v_changed := array_append(v_changed, 'group_id');
  end if;

  if p_changes ? 'due_date' then
    v_date := nullif(p_changes ->> 'due_date', '')::date;
    v_time := nullif(p_changes ->> 'due_time', '')::time;
    if v_time is not null and v_date is null then
      perform private.fail('invalid', 'Saat seçtiyseniz tarih de seçin.');
    end if;
    v_due_at := private.task_due_at(v_old.company_id, v_date, v_time);
    v_all_day := v_date is not null and v_time is null;
  else
    v_due_at := v_old.due_at;
    v_all_day := v_old.due_all_day;
  end if;

  select coalesce(array_agg(user_id order by user_id), '{}') into v_old_contribs
  from public.task_contributors where task_id = p_task;
  if p_changes ? 'contributor_ids' then
    v_contribs := array(
      select distinct x::uuid from jsonb_array_elements_text(coalesce(p_changes -> 'contributor_ids', '[]'::jsonb)) x
      where x::uuid <> v_assignee order by 1
    );
    if cardinality(v_contribs) > 20 then
      perform private.fail('invalid', 'En fazla 20 katkıda bulunan eklenebilir.');
    end if;
  else
    v_contribs := array(select x from unnest(v_old_contribs) x where x <> v_assignee order by 1);
  end if;

  -- Yeni eklenen kişiler için atama yetkisi
  perform private.assert_can_assign(
    v_old.company_id, v_group,
    array(select x from unnest(array[v_assignee] || v_contribs) x
          where x <> v_old.assignee_id and not (x = any (v_old_contribs)))
  );

  if v_title <> v_old.title then v_changed := array_append(v_changed, 'title'); end if;
  if v_desc <> v_old.description then v_changed := array_append(v_changed, 'description'); end if;
  if v_priority <> v_old.priority then v_changed := array_append(v_changed, 'priority'); end if;
  if v_assignee <> v_old.assignee_id then v_changed := array_append(v_changed, 'assignee_id'); end if;
  if v_due_at is distinct from v_old.due_at or v_all_day <> v_old.due_all_day then v_changed := array_append(v_changed, 'due_at'); end if;
  if v_contribs <> v_old_contribs then v_changed := array_append(v_changed, 'contributors'); end if;

  if cardinality(v_changed) = 0 then
    return v_old; -- değişiklik yok (tekrar deneme güvenli)
  end if;

  update public.tasks
  set title = v_title,
      description = v_desc,
      priority = v_priority,
      assignee_id = v_assignee,
      group_id = v_group,
      due_at = v_due_at,
      due_all_day = v_all_day,
      notified_at = case when v_assignee <> v_old.assignee_id then null else notified_at end,
      seen_at = case when v_assignee <> v_old.assignee_id then null else seen_at end,
      accepted_at = case when v_assignee <> v_old.assignee_id then null else accepted_at end
  where id = p_task
  returning * into v_new;

  if 'contributors' = any (v_changed) then
    delete from public.task_contributors where task_id = p_task and not (user_id = any (v_contribs));
    insert into public.task_contributors (company_id, task_id, user_id)
    select v_old.company_id, p_task, x from unnest(v_contribs) x
    on conflict do nothing;
  end if;

  insert into public.task_events (company_id, task_id, actor_id, type, data)
  values (v_old.company_id, p_task, v_uid, 'updated', jsonb_build_object(
    'fields', to_jsonb(v_changed),
    'assignee_from', v_old.assignee_id, 'assignee_to', v_assignee,
    'due_from', v_old.due_at, 'due_to', v_due_at))
  returning id into v_event;

  if 'assignee_id' = any (v_changed) then
    if private.notify(v_old.company_id, v_assignee, 'tasks', 'task_assigned', 'task', p_task,
         'Size yeni görev verildi', v_title, 'te:' || v_event,
         jsonb_build_object('by', private.display_name(v_uid))) then
      update public.tasks set notified_at = now() where id = p_task returning * into v_new;
    end if;
  elsif 'due_at' = any (v_changed) or 'title' = any (v_changed) or 'description' = any (v_changed) then
    perform private.notify(v_old.company_id, v_assignee, 'tasks', 'task_updated', 'task', p_task,
      'Görevinizde değişiklik yapıldı', v_title, 'te:' || v_event);
  end if;

  foreach c in array array(select x from unnest(v_contribs) x where not (x = any (v_old_contribs))) loop
    perform private.notify(v_old.company_id, c, 'tasks', 'task_contributor_added', 'task', p_task,
      'Bir göreve katkıda bulunan olarak eklendiniz', v_title, 'te:' || v_event);
  end loop;

  return v_new;
end;
$$;

-- Durum değişikliği. Yetki: sorumlu, görevi veren, kapsamında tasks.manage_all olan.
-- Aynı duruma tekrar geçiş işlem/bildirim üretmez (tekrar deneme güvenli).
create function public.set_task_status(
  p_task uuid,
  p_status public.task_status,
  p_reason text default null,
  p_expected_version integer default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_task public.tasks;
  v_old public.task_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_event bigint;
  v_type text;
  v_title text;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or not private.user_can_view_task(v_uid, p_task) then
    perform private.fail('not_found', 'Görev bulunamadı.');
  end if;
  perform private.require_module(v_task.company_id, 'tasks');
  if not (
    v_task.assignee_id = v_uid
    or v_task.created_by = v_uid
    or private.has_perm(v_task.company_id, 'tasks.manage_all', v_task.group_id)
  ) then
    perform private.fail('forbidden', 'Bu görevin durumunu değiştirme yetkiniz yok.');
  end if;
  if p_status = 'on_hold' and (v_reason is null or char_length(v_reason) < 3) then
    perform private.fail('invalid', 'Beklemeye alırken kısa bir neden yazın.');
  end if;
  if char_length(v_reason) > 300 then
    perform private.fail('invalid', 'Neden en fazla 300 karakter olabilir.');
  end if;

  if v_task.status = p_status and (p_status <> 'on_hold' or v_task.hold_reason is not distinct from v_reason) then
    return v_task;
  end if;
  if p_expected_version is not null and v_task.version <> p_expected_version then
    perform private.fail('conflict', 'Görev siz bakarken güncellendi. Yenileyip tekrar deneyin.');
  end if;

  v_old := v_task.status;
  update public.tasks
  set status = p_status,
      hold_reason = case when p_status = 'on_hold' then v_reason else null end,
      started_at = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
      accepted_at = case when p_status = 'in_progress' and accepted_at is null and assignee_id = v_uid then now() else accepted_at end,
      seen_at = case when seen_at is null and assignee_id = v_uid then now() else seen_at end,
      completed_at = case when p_status = 'done' then now() else null end
  where id = p_task
  returning * into v_task;

  insert into public.task_events (company_id, task_id, actor_id, type, data)
  values (v_task.company_id, p_task, v_uid, 'status_changed',
          jsonb_build_object('from', v_old, 'to', p_status, 'reason', v_reason))
  returning id into v_event;

  v_type := case when p_status = 'done' then 'task_completed' else 'task_status_changed' end;
  v_title := case
    when p_status = 'done' then 'Görev tamamlandı'
    when p_status = 'on_hold' then 'Görev beklemeye alındı'
    else 'Görev durumu: ' || private.task_status_label(p_status)
  end;

  perform private.notify(v_task.company_id, v_task.created_by, 'tasks', v_type, 'task', p_task,
    v_title, v_task.title, 'te:' || v_event, jsonb_build_object('status', p_status, 'reason', v_reason));
  perform private.notify(v_task.company_id, v_task.assignee_id, 'tasks', v_type, 'task', p_task,
    v_title, v_task.title, 'te:' || v_event, jsonb_build_object('status', p_status, 'reason', v_reason));

  return v_task;
end;
$$;

-- Sorumlu görevi açtığında bir kez "görüldü" kaydı düşer (başkaları için etkisiz).
create function public.mark_task_seen(p_task uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or not private.user_can_view_task(v_uid, p_task) then
    perform private.fail('not_found', 'Görev bulunamadı.');
  end if;
  if v_task.assignee_id <> v_uid or v_task.seen_at is not null or not private.module_enabled(v_task.company_id, 'tasks') then
    return v_task;
  end if;
  update public.tasks set seen_at = now() where id = p_task returning * into v_task;
  insert into public.task_events (company_id, task_id, actor_id, type) values (v_task.company_id, p_task, v_uid, 'seen');
  return v_task;
end;
$$;

-- Sorumlu "Üstlendim" der. Tekrar çağrılırsa etkisizdir.
create function public.accept_task(p_task uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_task public.tasks;
  v_event bigint;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or not private.user_can_view_task(v_uid, p_task) then
    perform private.fail('not_found', 'Görev bulunamadı.');
  end if;
  perform private.require_module(v_task.company_id, 'tasks');
  if v_task.assignee_id <> v_uid then
    perform private.fail('forbidden', 'Yalnızca görevin sorumlusu üstlenebilir.');
  end if;
  if v_task.accepted_at is not null then
    return v_task;
  end if;
  update public.tasks set accepted_at = now(), seen_at = coalesce(seen_at, now()) where id = p_task returning * into v_task;
  insert into public.task_events (company_id, task_id, actor_id, type) values (v_task.company_id, p_task, v_uid, 'accepted')
  returning id into v_event;
  perform private.notify(v_task.company_id, v_task.created_by, 'tasks', 'task_accepted', 'task', p_task,
    'Görev üstlenildi', v_task.title, 'te:' || v_event);
  return v_task;
end;
$$;

-- Görev yorumu + @etiketleme. Etiketlenen kişi görevi görebilmeli.
-- Etiketlenen kişiye "etiketlendiniz", diğer taraflara "yeni yorum" bildirimi gider;
-- aynı yorum için kişi başına tek bildirim (dedupe 'tc:<yorum>').
create function public.add_task_comment(
  p_task uuid,
  p_body text,
  p_client_request_id uuid,
  p_mentions uuid[] default '{}'
)
returns public.task_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_task public.tasks;
  v_comment public.task_comments;
  v_body text := btrim(coalesce(p_body, ''));
  v_mentions uuid[];
  v_name text;
  u uuid;
begin
  select * into v_task from public.tasks where id = p_task;
  if not found or not private.user_can_view_task(v_uid, p_task) then
    perform private.fail('not_found', 'Görev bulunamadı.');
  end if;
  perform private.require_module(v_task.company_id, 'tasks');
  if p_client_request_id is null then
    perform private.fail('invalid', 'İstek kimliği eksik.');
  end if;

  select * into v_comment from public.task_comments where author_id = v_uid and client_request_id = p_client_request_id;
  if found then
    return v_comment;
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 4000 then
    perform private.fail('invalid', 'Yorum 1-4000 karakter olmalı.');
  end if;
  v_mentions := array(select distinct x from unnest(coalesce(p_mentions, '{}')) x where x is not null and x <> v_uid);
  if exists (select 1 from unnest(v_mentions) x where not private.user_can_view_task(x, p_task)) then
    perform private.fail('invalid', 'Etiketlediğiniz kişilerden biri bu görevi göremiyor.');
  end if;

  insert into public.task_comments (company_id, task_id, author_id, body, client_request_id)
  values (v_task.company_id, p_task, v_uid, v_body, p_client_request_id)
  on conflict (author_id, client_request_id) do nothing
  returning * into v_comment;
  if v_comment.id is null then
    select * into v_comment from public.task_comments where author_id = v_uid and client_request_id = p_client_request_id;
    return v_comment;
  end if;

  insert into public.task_comment_mentions (comment_id, company_id, task_id, user_id)
  select v_comment.id, v_task.company_id, p_task, x from unnest(v_mentions) x;

  insert into public.task_events (company_id, task_id, actor_id, type, data)
  values (v_task.company_id, p_task, v_uid, 'comment_added', jsonb_build_object('comment_id', v_comment.id, 'mentions', to_jsonb(v_mentions)));

  v_name := private.display_name(v_uid);
  foreach u in array v_mentions loop
    perform private.notify(v_task.company_id, u, 'tasks', 'task_mention', 'task', p_task,
      v_name || ' sizi bir görevde etiketledi', v_task.title, 'tc:' || v_comment.id);
  end loop;
  for u in
    select distinct x from (
      select v_task.assignee_id as x
      union select v_task.created_by
      union select user_id from public.task_contributors where task_id = p_task
    ) s
  loop
    perform private.notify(v_task.company_id, u, 'tasks', 'task_comment', 'task', p_task,
      v_name || ' göreve yorum yazdı', v_task.title, 'tc:' || v_comment.id);
  end loop;

  return v_comment;
end;
$$;

-- =====================================================================
-- Realtime
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tasks, public.task_events, public.task_comments;
  end if;
end;
$$;

select private.apply_api_grants();
