-- =====================================================================
-- GÖREV ONAYI MODÜLÜ (task_approval) — Görevler modülüne bağımlı, isteğe bağlı
--
-- Görev oluşturulurken "tamamlanınca onay gerekli" seçilebilir (onaylayıcı seçilir).
-- Sorumlu görevi tamamlayınca onay durumu "Onay bekliyor" olur ve onaylayıcıya bildirim gider.
-- Onaylayıcı:  Onayla              → "Onaylandı"
--              Düzeltme iste (+not) → "Düzeltme istendi", görev "Devam ediyor"a döner, sorumluya not gider.
-- Tamamlandı (iş yapıldı) ile onay (iş kabul edildi) ayrı alanlardır; karıştırılmaz.
-- Modül kapalıyken: yeni onay kararı verilemez, onay bildirimi üretilmez, onay gerektiren görev
-- oluşturulamaz; mevcut onay kayıtları silinmez ve modül açılınca kaldığı yerden devam eder.
-- =====================================================================

insert into public.modules (id, name, is_core, depends_on, sort_order)
values ('task_approval', 'Görev onayı', false, '{tasks}', 30);

insert into public.permissions (key, module_id, scope, label) values
  ('tasks.approve', 'task_approval', 'group', 'Tamamlanan görevi onaylama veya düzeltme isteme');

insert into public.role_permissions (role, permission) values ('owner', 'tasks.approve'), ('admin', 'tasks.approve');
insert into public.group_role_permissions (role, permission) values ('manager', 'tasks.approve');

insert into public.company_modules (company_id, module_id, enabled)
select id, 'task_approval', true from public.companies
on conflict do nothing;

create type public.task_approval_status as enum ('pending', 'approved', 'changes_requested');

alter table public.tasks
  add column requires_approval boolean not null default false,
  add column approver_id uuid,
  add column approval_status public.task_approval_status,
  add column approval_note text check (approval_note is null or char_length(approval_note) between 3 and 500),
  add column approval_requested_at timestamptz,
  add column approval_decided_at timestamptz,
  add column approval_decided_by uuid references auth.users (id) on delete set null,
  add constraint tasks_approver_fk foreign key (company_id, approver_id) references public.company_members (company_id, user_id),
  add constraint tasks_approval_requires_approver check (requires_approval = (approver_id is not null)),
  add constraint tasks_approval_status_requires check (approval_status is null or requires_approval),
  add constraint tasks_changes_need_note check (approval_status is distinct from 'changes_requested' or approval_note is not null);

create index tasks_approver_pending_idx on public.tasks (company_id, approver_id) where approval_status = 'pending';

-- =====================================================================
-- Yetki yardımcıları
-- =====================================================================

-- Görev görünürlüğüne onaylayıcı eklenir (grup üyesi olmasa da onaylayacağı görevi görür)
create or replace function private.user_can_view_task_row(p_user uuid, p_company uuid, p_task uuid, p_assignee uuid, p_creator uuid, p_group uuid)
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
          or exists (select 1 from public.tasks t where t.id = p_task and t.approver_id = p_user)
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

-- Onaylayıcı: aktif üye, görevin sorumlusu değil, görevin kapsamında tasks.approve izni var.
create function private.assert_valid_approver(p_company uuid, p_group uuid, p_approver uuid, p_assignee uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_module(p_company, 'task_approval');
  if p_approver is null then
    perform private.fail('invalid', 'Onaylayacak kişiyi seçin.');
  end if;
  if not private.user_is_member(p_approver, p_company) then
    perform private.fail('invalid', 'Onaylayacak kişi şirketin aktif üyesi değil.');
  end if;
  if p_approver = p_assignee then
    perform private.fail('invalid', 'Görevin sorumlusu kendi görevini onaylayamaz; başka bir onaylayıcı seçin.');
  end if;
  if not private.user_has_perm(p_approver, p_company, 'tasks.approve', p_group) then
    perform private.fail('invalid', 'Seçilen kişinin bu görevi onaylama yetkisi yok.');
  end if;
end;
$$;

-- Onay kararı verebilir mi: onaylayıcı; onaylayıcı şirketten ayrıldıysa kapsamında tasks.approve + tasks.manage_all olan.
create function private.user_can_decide_approval(p_user uuid, p_task public.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user <> p_task.assignee_id
    and (
      (p_task.approver_id = p_user and private.user_has_perm(p_user, p_task.company_id, 'tasks.approve', p_task.group_id))
      or (
        not private.user_is_member(p_task.approver_id, p_task.company_id)
        and private.user_has_perm(p_user, p_task.company_id, 'tasks.approve', p_task.group_id)
        and private.user_has_perm(p_user, p_task.company_id, 'tasks.manage_all', p_task.group_id)
      )
    );
$$;

-- =====================================================================
-- Görev oluşturma: onay seçenekleri eklenir (imza değiştiği için yeniden oluşturulur)
-- =====================================================================
drop function public.create_task(uuid, text, uuid, uuid, text, uuid[], date, time, public.task_priority, uuid);
drop function private.create_task_internal(uuid, text, uuid, uuid, text, uuid[], date, time, public.task_priority, uuid, uuid);

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
  p_source_message uuid,
  p_requires_approval boolean default false,
  p_approver uuid default null
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
  if coalesce(p_requires_approval, false) then
    perform private.assert_valid_approver(p_company, p_group, p_approver, p_assignee);
  end if;

  insert into public.tasks (
    company_id, title, description, priority, assignee_id, created_by, group_id,
    due_at, due_all_day, source_message_id, client_request_id, requires_approval, approver_id
  )
  values (
    p_company, v_title, v_desc, coalesce(p_priority, 'normal'), p_assignee, v_uid, p_group,
    private.task_due_at(p_company, p_due_date, p_due_time), p_due_date is not null and p_due_time is null,
    p_source_message, p_client_request_id,
    coalesce(p_requires_approval, false), case when coalesce(p_requires_approval, false) then p_approver end
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
    'assignee_id', p_assignee, 'contributors', to_jsonb(v_contribs), 'source_message_id', p_source_message,
    'requires_approval', v_task.requires_approval, 'approver_id', v_task.approver_id))
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
  p_group uuid default null,
  p_requires_approval boolean default false,
  p_approver uuid default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.create_task_internal(
    p_company, p_title, p_assignee, p_client_request_id, p_description, p_contributors,
    p_due_date, p_due_time, p_priority, p_group, null, p_requires_approval, p_approver
  );
end;
$$;

-- Var olan görevde onay gerekliliğini açma/kapama veya onaylayıcı değiştirme (görevi düzenleyebilen kişi).
-- Bekleyen onay varken onaylayıcı değişirse yeni onaylayıcıya bildirim gider.
create function public.set_task_approval(p_task uuid, p_requires_approval boolean, p_approver uuid default null)
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
  perform private.require_module(v_task.company_id, 'task_approval');
  if not private.user_can_manage_task(v_uid, v_task) then
    perform private.fail('forbidden', 'Bu görevi düzenleme yetkiniz yok.');
  end if;

  if not coalesce(p_requires_approval, false) then
    if not v_task.requires_approval then
      return v_task;
    end if;
    update public.tasks
    set requires_approval = false, approver_id = null, approval_status = null, approval_note = null
    where id = p_task returning * into v_task;
  else
    perform private.assert_valid_approver(v_task.company_id, v_task.group_id, p_approver, v_task.assignee_id);
    if v_task.requires_approval and v_task.approver_id = p_approver then
      return v_task;
    end if;
    update public.tasks
    set requires_approval = true,
        approver_id = p_approver,
        -- Görev zaten tamamlanmışsa ve henüz karar yoksa onaya düşer
        approval_status = case when status = 'done' and approval_status is distinct from 'approved' then 'pending'::public.task_approval_status else approval_status end,
        approval_requested_at = case when status = 'done' and approval_status is distinct from 'approved' then now() else approval_requested_at end
    where id = p_task returning * into v_task;
  end if;

  insert into public.task_events (company_id, task_id, actor_id, type, data)
  values (v_task.company_id, p_task, v_uid, 'updated',
          jsonb_build_object('fields', jsonb_build_array('approval'), 'requires_approval', v_task.requires_approval, 'approver_id', v_task.approver_id))
  returning id into v_event;

  if v_task.approval_status = 'pending' then
    perform private.notify(v_task.company_id, v_task.approver_id, 'task_approval', 'task_approval_requested', 'task', p_task,
      'Onayınızı bekleyen görev', v_task.title, 'te:' || v_event);
  end if;
  return v_task;
end;
$$;

-- =====================================================================
-- Durum değişikliği: tamamlanınca onaya düşer; tamamlanmış görev yeniden açılırsa onay sıfırlanır.
-- (Aşama 1 sürümünün aynısı + onay adımları)
-- =====================================================================
create or replace function public.set_task_status(
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
  v_needs_approval boolean;
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
  v_needs_approval := p_status = 'done' and v_task.requires_approval;
  update public.tasks
  set status = p_status,
      hold_reason = case when p_status = 'on_hold' then v_reason else null end,
      started_at = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
      accepted_at = case when p_status = 'in_progress' and accepted_at is null and assignee_id = v_uid then now() else accepted_at end,
      seen_at = case when seen_at is null and assignee_id = v_uid then now() else seen_at end,
      completed_at = case when p_status = 'done' then now() else null end,
      approval_status = case
        when v_needs_approval then 'pending'::public.task_approval_status
        when v_old = 'done' then null -- tamamlanmış görev yeniden açıldı: önceki onay geçersiz
        else approval_status
      end,
      approval_requested_at = case when v_needs_approval then now() else approval_requested_at end,
      approval_note = case when v_needs_approval or v_old = 'done' then null else approval_note end,
      approval_decided_at = case when v_needs_approval or v_old = 'done' then null else approval_decided_at end,
      approval_decided_by = case when v_needs_approval or v_old = 'done' then null else approval_decided_by end
  where id = p_task
  returning * into v_task;

  insert into public.task_events (company_id, task_id, actor_id, type, data)
  values (v_task.company_id, p_task, v_uid, 'status_changed',
          jsonb_build_object('from', v_old, 'to', p_status, 'reason', v_reason))
  returning id into v_event;

  v_type := case when p_status = 'done' then 'task_completed' else 'task_status_changed' end;
  v_title := case
    when p_status = 'done' and v_needs_approval then 'Görev tamamlandı, onay bekliyor'
    when p_status = 'done' then 'Görev tamamlandı'
    when p_status = 'on_hold' then 'Görev beklemeye alındı'
    else 'Görev durumu: ' || private.task_status_label(p_status)
  end;

  perform private.notify(v_task.company_id, v_task.created_by, 'tasks', v_type, 'task', p_task,
    v_title, v_task.title, 'te:' || v_event, jsonb_build_object('status', p_status, 'reason', v_reason));
  perform private.notify(v_task.company_id, v_task.assignee_id, 'tasks', v_type, 'task', p_task,
    v_title, v_task.title, 'te:' || v_event, jsonb_build_object('status', p_status, 'reason', v_reason));

  if v_needs_approval then
    insert into public.task_events (company_id, task_id, actor_id, type, data)
    values (v_task.company_id, p_task, v_uid, 'approval_requested', jsonb_build_object('approver_id', v_task.approver_id))
    returning id into v_event;
    perform private.notify(v_task.company_id, v_task.approver_id, 'task_approval', 'task_approval_requested', 'task', p_task,
      'Onayınızı bekleyen görev', v_task.title, 'te:' || v_event, jsonb_build_object('by', private.display_name(v_uid)));
  end if;

  return v_task;
end;
$$;

-- =====================================================================
-- Onay kararları
-- =====================================================================
create function public.approve_task(p_task uuid)
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
  perform private.require_module(v_task.company_id, 'task_approval');
  if not v_task.requires_approval or not private.user_can_decide_approval(v_uid, v_task) then
    perform private.fail('forbidden', 'Bu görevi onaylama yetkiniz yok.');
  end if;
  if v_task.approval_status = 'approved' then
    return v_task; -- tekrar deneme güvenli
  end if;
  if v_task.approval_status is distinct from 'pending' then
    perform private.fail('invalid', 'Görev onay beklemiyor.');
  end if;

  update public.tasks
  set approval_status = 'approved', approval_note = null, approval_decided_at = now(), approval_decided_by = v_uid
  where id = p_task returning * into v_task;
  insert into public.task_events (company_id, task_id, actor_id, type)
  values (v_task.company_id, p_task, v_uid, 'approved')
  returning id into v_event;
  perform private.notify(v_task.company_id, v_task.assignee_id, 'task_approval', 'task_approved', 'task', p_task,
    'Göreviniz onaylandı', v_task.title, 'te:' || v_event);
  return v_task;
end;
$$;

create function public.request_task_changes(p_task uuid, p_note text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_task public.tasks;
  v_note text := btrim(coalesce(p_note, ''));
  v_event bigint;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or not private.user_can_view_task(v_uid, p_task) then
    perform private.fail('not_found', 'Görev bulunamadı.');
  end if;
  perform private.require_module(v_task.company_id, 'tasks');
  perform private.require_module(v_task.company_id, 'task_approval');
  if not v_task.requires_approval or not private.user_can_decide_approval(v_uid, v_task) then
    perform private.fail('forbidden', 'Bu görev için düzeltme isteme yetkiniz yok.');
  end if;
  if char_length(v_note) < 3 or char_length(v_note) > 500 then
    perform private.fail('invalid', 'Neyin düzeltilmesi gerektiğini kısaca yazın (3-500 karakter).');
  end if;
  if v_task.approval_status = 'changes_requested' and v_task.approval_note = v_note then
    return v_task; -- tekrar deneme güvenli
  end if;
  if v_task.approval_status is distinct from 'pending' then
    perform private.fail('invalid', 'Görev onay beklemiyor.');
  end if;

  update public.tasks
  set approval_status = 'changes_requested', approval_note = v_note,
      approval_decided_at = now(), approval_decided_by = v_uid,
      status = 'in_progress', completed_at = null
  where id = p_task returning * into v_task;
  insert into public.task_events (company_id, task_id, actor_id, type, data)
  values (v_task.company_id, p_task, v_uid, 'changes_requested', jsonb_build_object('note', v_note))
  returning id into v_event;
  perform private.notify(v_task.company_id, v_task.assignee_id, 'task_approval', 'task_changes_requested', 'task', p_task,
    'Düzeltme istendi', v_task.title || ' — ' || v_note, 'te:' || v_event, jsonb_build_object('note', v_note));
  return v_task;
end;
$$;

select private.apply_api_grants();
