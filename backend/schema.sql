-- Run in the Supabase SQL editor as the project owner. No passwords belong in this file.
create schema if not exists tkb_private;
revoke all on schema tkb_private from public, anon, authenticated;

create table if not exists public.tkb_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null unique check (role in ('khoi','nhan','parents'))
);
alter table public.tkb_profiles enable row level security;
revoke all on public.tkb_profiles from anon, authenticated;
grant select on public.tkb_profiles to authenticated;
drop policy if exists tkb_own_profile on public.tkb_profiles;
create policy tkb_own_profile on public.tkb_profiles for select to authenticated using (user_id = (select auth.uid()));

create or replace function tkb_private.viewer_role() returns text
language sql stable security definer set search_path = '' as $$
 select role from public.tkb_profiles where user_id = auth.uid()
$$;
grant usage on schema tkb_private to authenticated;
revoke all on function tkb_private.viewer_role() from public;
grant execute on function tkb_private.viewer_role() to authenticated;

create table if not exists public.tkb_timetables (
 student text primary key check (student in ('khoi','nhan')),
 days jsonb not null check (jsonb_typeof(days) = 'array')
);
alter table public.tkb_timetables enable row level security;
revoke all on public.tkb_timetables from anon, authenticated;
grant select on public.tkb_timetables to authenticated;
drop policy if exists tkb_read_timetable on public.tkb_timetables;
create policy tkb_read_timetable on public.tkb_timetables for select to authenticated
 using (tkb_private.viewer_role() = 'parents' or student = tkb_private.viewer_role());

create table if not exists public.tkb_tasks (
 day date not null,
 owner text not null check (owner in ('shared','khoi','nhan')),
 task_id text not null,
 completed boolean not null default false,
 completed_at timestamptz,
 completed_by text check (completed_by in ('khoi','nhan')),
 note text check (note is null or note = 'không có'),
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 primary key(day,owner,task_id),
 check ((completed and completed_at is not null and completed_by is not null)
    or (not completed and completed_at is null and completed_by is null and note is null))
);
alter table public.tkb_tasks enable row level security;
revoke all on public.tkb_tasks from anon, authenticated;
grant select on public.tkb_tasks to authenticated;
drop policy if exists tkb_read_tasks on public.tkb_tasks;
create policy tkb_read_tasks on public.tkb_tasks for select to authenticated
 using (tkb_private.viewer_role() is not null and
  (owner = 'shared' or owner = tkb_private.viewer_role() or tkb_private.viewer_role() = 'parents'));

create table if not exists public.tkb_parent_notes (
 day date not null,
 child text not null check (child in ('khoi','nhan')),
 message text not null check (length(message) between 1 and 500),
 updated_at timestamptz not null default now(),
 primary key(day,child)
);
alter table public.tkb_parent_notes enable row level security;
revoke all on public.tkb_parent_notes from anon,authenticated;
grant select on public.tkb_parent_notes to authenticated;
drop policy if exists tkb_read_parent_notes on public.tkb_parent_notes;
create policy tkb_read_parent_notes on public.tkb_parent_notes for select to authenticated
 using (tkb_private.viewer_role()='parents' or child=tkb_private.viewer_role());

create or replace function public.tkb_set_parent_note(p_day date,p_child text,p_message text)
returns public.tkb_parent_notes
language plpgsql security definer set search_path='' as $$
declare saved public.tkb_parent_notes%rowtype;
begin
 if tkb_private.viewer_role()<>'parents' then raise exception 'Not allowed' using errcode='42501'; end if;
 if p_day is null or p_child not in ('khoi','nhan') or p_message is null
   or length(btrim(p_message))>500 then raise exception 'Invalid note'; end if;
 if btrim(p_message)='' then
  delete from public.tkb_parent_notes where day=p_day and child=p_child returning * into saved;
  return saved;
 end if;
 insert into public.tkb_parent_notes(day,child,message) values(p_day,p_child,btrim(p_message))
 on conflict(day,child) do update set message=excluded.message,updated_at=now()
 returning * into saved;
 return saved;
end $$;
revoke all on function public.tkb_set_parent_note(date,text,text) from public,anon;
grant execute on function public.tkb_set_parent_note(date,text,text) to authenticated;

create table if not exists public.tkb_snack_fund (
 id uuid primary key,
 day date not null,
 kind text not null check (kind in ('income','expense')),
 child text check (child in ('khoi','nhan')),
 item text not null check (length(item) between 1 and 100),
 amount bigint not null check (amount between 1000 and 10000000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 check ((kind='income' and child is null) or (kind='expense' and child is not null))
);
alter table public.tkb_snack_fund enable row level security;
revoke all on public.tkb_snack_fund from anon,authenticated;
grant select on public.tkb_snack_fund to authenticated;
drop policy if exists tkb_read_snack_fund on public.tkb_snack_fund;
create policy tkb_read_snack_fund on public.tkb_snack_fund for select to authenticated
 using (tkb_private.viewer_role() is not null);

create or replace function public.tkb_add_snack_transaction(
 p_id uuid,p_day date,p_kind text,p_item text,p_amount bigint
) returns public.tkb_snack_fund
language plpgsql security definer set search_path='' as $$
declare actor text:=tkb_private.viewer_role();saved public.tkb_snack_fund%rowtype;
begin
 if actor is null or p_id is null or p_day is null or p_kind not in ('income','expense')
   or p_item is null or length(btrim(p_item)) not between 1 and 100
   or p_amount not between 1000 and 10000000
   or p_day>(now() at time zone 'Asia/Ho_Chi_Minh')::date
   or p_day<(now() at time zone 'Asia/Ho_Chi_Minh')::date-30 then raise exception 'Invalid transaction'; end if;
 if (actor='parents' and p_kind<>'income') or (actor<>'parents' and p_kind<>'expense') then
  raise exception 'Not allowed' using errcode='42501'; end if;
 insert into public.tkb_snack_fund(id,day,kind,child,item,amount,created_by)
 values(p_id,p_day,p_kind,case when p_kind='expense' then actor else null end,btrim(p_item),p_amount,auth.uid())
 on conflict(id) do nothing returning * into saved;
 if saved.id is null then select * into saved from public.tkb_snack_fund where id=p_id and created_by=auth.uid(); end if;
 if saved.id is null then raise exception 'Transaction conflict'; end if;
 return saved;
end $$;
revoke all on function public.tkb_add_snack_transaction(uuid,date,text,text,bigint) from public,anon;
grant execute on function public.tkb_add_snack_transaction(uuid,date,text,text,bigint) to authenticated;

create or replace function public.tkb_delete_snack_transaction(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor text:=tkb_private.viewer_role();entry public.tkb_snack_fund%rowtype;
begin
 select * into entry from public.tkb_snack_fund where id=p_id;
 if entry.id is null then return; end if;
 if actor is null or (actor<>'parents' and (entry.created_by<>auth.uid() or entry.kind<>'expense'
   or entry.day<>(now() at time zone 'Asia/Ho_Chi_Minh')::date)) then
  raise exception 'Not allowed' using errcode='42501'; end if;
 delete from public.tkb_snack_fund where id=p_id;
end $$;
revoke all on function public.tkb_delete_snack_transaction(uuid) from public,anon;
grant execute on function public.tkb_delete_snack_transaction(uuid) to authenticated;

create table if not exists tkb_private.operations (
 user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 result jsonb not null,
 primary key(user_id,operation_id)
);
revoke all on tkb_private.operations from public, anon, authenticated;

-- Catalog edits preserve completion IDs and historical day membership.
create table if not exists public.tkb_task_catalog (
 owner text not null check(owner in ('shared','khoi','nhan')),
 task_id text not null check(length(task_id) between 1 and 80),
 name text not null check(length(btrim(name)) between 1 and 160),
 position integer not null default 100,
 active_from date not null,
 retired_on date,
 revision bigint not null default 1,
 primary key(owner,task_id)
);
alter table public.tkb_task_catalog enable row level security;
revoke all on public.tkb_task_catalog from anon,authenticated;
grant select on public.tkb_task_catalog to authenticated;
drop policy if exists tkb_read_catalog on public.tkb_task_catalog;
create policy tkb_read_catalog on public.tkb_task_catalog for select to authenticated
 using(tkb_private.viewer_role() is not null and (owner='shared' or owner=tkb_private.viewer_role() or tkb_private.viewer_role()='parents'));
insert into public.tkb_task_catalog(owner,task_id,name,position,active_from) values
('shared','kitchen','Quét và lau khu bếp',0,'2000-01-01'),
('shared','garage','Quét và lau nhà để xe',1,'2000-01-01'),
('shared','floor-2','Quét nhà tầng 2',2,'2000-01-01'),
('shared','leaves','Lượm lá trước sân',3,'2000-01-01'),
('shared','trash','Vứt rác',4,'2000-01-01'),
('shared','plants','Tưới cây',5,'2000-01-01'),
('shared','table','Lau bàn',6,'2000-01-01'),
('shared','laundry','Phơi đồ trên tầng 3',7,'2000-01-01'),
('shared','stairs','Lượm rác cầu thang',8,'2000-01-01'),
('shared','fish','Cho cá ăn',9,'2000-01-01'),
('khoi','bath','Tắm rửa',0,'2000-01-01'),
('khoi','uniform','Giặt đồ đi học',1,'2000-01-01'),
('khoi','school-homework','Làm bài tập trên trường',2,'2000-01-01'),
('khoi','extra-homework','Làm bài tập học thêm',3,'2000-01-01'),
('khoi','sm-homework','Làm bài tập ở SM',4,'2000-01-01'),
('khoi','prepare','Soạn thời khóa biểu',5,'2000-01-01'),
('nhan','bath','Tắm rửa',0,'2000-01-01'),
('nhan','uniform','Giặt đồ đi học',1,'2000-01-01'),
('nhan','school-homework','Làm bài tập trên trường',2,'2000-01-01'),
('nhan','sm-homework','Làm bài tập ở SM',3,'2000-01-01'),
('nhan','prepare','Soạn thời khóa biểu',4,'2000-01-01')
on conflict do nothing;
create or replace function public.tkb_save_catalog(p_owner text,p_task text,p_name text,p_remove boolean,p_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.tkb_task_catalog%rowtype;
begin
 if tkb_private.viewer_role() is distinct from 'parents' then raise exception 'Not allowed' using errcode='42501'; end if;
 if p_owner is null or p_owner not in ('shared','khoi','nhan') or p_task is null or p_task !~ '^[a-z0-9-]{1,80}$' or p_remove is null or p_revision is null then raise exception 'Invalid task'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('catalog:'||p_owner||':'||p_task,0));
 select * into existing from public.tkb_task_catalog where owner=p_owner and task_id=p_task;
 if coalesce(existing.revision,0)<>p_revision or existing.retired_on is not null then raise exception 'Task changed. Reload and retry.' using errcode='40001'; end if;
 if p_remove then
  if existing.task_id is null then raise exception 'Unknown task'; end if;
  update public.tkb_task_catalog set retired_on=(now() at time zone 'Asia/Ho_Chi_Minh')::date,revision=revision+1 where owner=p_owner and task_id=p_task;
 else
  if p_name is null or length(btrim(p_name)) not between 1 and 160 then raise exception 'Invalid name'; end if;
  insert into public.tkb_task_catalog(owner,task_id,name,active_from) values(p_owner,p_task,btrim(p_name),(now() at time zone 'Asia/Ho_Chi_Minh')::date)
  on conflict(owner,task_id) do update set name=excluded.name,revision=tkb_task_catalog.revision+1;
 end if;
end $$;
revoke all on function public.tkb_save_catalog(text,text,text,boolean,bigint) from public,anon;
grant execute on function public.tkb_save_catalog(text,text,text,boolean,bigint) to authenticated;
-- Per-day exceptions override only the matching task and date.
create table if not exists public.tkb_daily_catalog (
 day date not null,
 owner text not null check(owner in ('shared','khoi','nhan')),
 task_id text not null check(task_id ~ '^[a-z0-9-]{1,80}$'),
 name text not null check(length(btrim(name)) between 1 and 160),
 removed boolean not null default false,
 revision bigint not null default 1,
 primary key(day,owner,task_id)
);
alter table public.tkb_daily_catalog enable row level security;
revoke all on public.tkb_daily_catalog from anon,authenticated;
grant select on public.tkb_daily_catalog to authenticated;
drop policy if exists tkb_read_daily_catalog on public.tkb_daily_catalog;
create policy tkb_read_daily_catalog on public.tkb_daily_catalog for select to authenticated
 using(tkb_private.viewer_role() is not null and (owner='shared' or owner=tkb_private.viewer_role() or tkb_private.viewer_role()='parents'));
create or replace function public.tkb_catalog_entries() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(entry),'[]'::jsonb) from (
  select to_jsonb(c)||jsonb_build_object('day',null,'removed',false) entry from public.tkb_task_catalog c
  union all
  select to_jsonb(d)||jsonb_build_object('position',100) from public.tkb_daily_catalog d
 ) entries
$$;
revoke all on function public.tkb_catalog_entries() from public,anon;
grant execute on function public.tkb_catalog_entries() to authenticated;
create or replace function public.tkb_save_daily_catalog(p_day date,p_owner text,p_task text,p_name text,p_remove boolean,p_revision bigint)
returns void language plpgsql security definer set search_path='' as $$
declare existing public.tkb_daily_catalog%rowtype;
begin
 if tkb_private.viewer_role() is distinct from 'parents' then raise exception 'Not allowed' using errcode='42501'; end if;
 if p_day is null or extract(isodow from p_day)>5 or p_owner is null or p_owner not in ('shared','khoi','nhan') or p_task is null or p_task !~ '^[a-z0-9-]{1,80}$' or p_remove is null or p_revision is null or p_name is null or length(btrim(p_name)) not between 1 and 160 then raise exception 'Invalid task'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('daily-catalog:'||p_day::text||':'||p_owner||':'||p_task,0));
 select * into existing from public.tkb_daily_catalog where day=p_day and owner=p_owner and task_id=p_task;
 if coalesce(existing.revision,0)<>p_revision then raise exception 'Task changed. Reload and retry.' using errcode='40001'; end if;
 insert into public.tkb_daily_catalog(day,owner,task_id,name,removed) values(p_day,p_owner,p_task,btrim(p_name),p_remove)
 on conflict(day,owner,task_id) do update set name=excluded.name,removed=excluded.removed,revision=tkb_daily_catalog.revision+1;
end $$;
revoke all on function public.tkb_save_daily_catalog(date,text,text,text,boolean,bigint) from public,anon;
grant execute on function public.tkb_save_daily_catalog(date,text,text,text,boolean,bigint) to authenticated;
create or replace function tkb_private.valid_task(p_owner text,p_task text,p_day date) returns boolean
language sql stable set search_path='' as $$
 select coalesce((select not removed from public.tkb_daily_catalog where day=p_day and owner=p_owner and task_id=p_task),
 exists(select 1 from public.tkb_task_catalog where owner=p_owner and task_id=p_task and active_from<=p_day and (retired_on is null or p_day<retired_on)))
$$;
revoke all on function tkb_private.valid_task(text,text,date) from public;

create or replace function public.tkb_set_task(
 p_day date,p_owner text,p_task text,p_complete boolean,p_note text,
 p_operation_id uuid,p_expected_revision bigint,p_changed_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 actor text := tkb_private.viewer_role();
 previous public.tkb_tasks%rowtype;
 saved public.tkb_tasks%rowtype;
 result jsonb;
begin
 if actor is null or actor = 'parents' or (p_owner <> 'shared' and p_owner <> actor) then
  raise exception 'Not allowed' using errcode='42501';
 end if;
 if p_operation_id is null or p_day is null or p_owner is null or p_task is null or p_complete is null
   or p_expected_revision is null or p_expected_revision < 0
   or not tkb_private.valid_task(p_owner,p_task,p_day) then raise exception 'Invalid task'; end if;
 -- Serialize duplicate retries before checking idempotency.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || p_operation_id::text,0));
 select o.result into result from tkb_private.operations o where user_id=auth.uid() and operation_id=p_operation_id;
 if found then return result; end if;
 if p_changed_at is null or p_day<>(p_changed_at at time zone 'Asia/Ho_Chi_Minh')::date
  or p_changed_at>now()+interval '5 minutes' or p_changed_at<now()-interval '30 days'
 then raise exception 'Invalid completion date'; end if;
 if p_note is not null and (p_note <> 'không có' or p_owner='shared'
    or p_task not in ('extra-homework','sm-homework') or not p_complete) then raise exception 'Invalid note'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_day::text || ':' || p_owner || ':' || p_task,0));
 select * into previous from public.tkb_tasks where day=p_day and owner=p_owner and task_id=p_task;
 if (p_owner='shared' and previous.completed and (p_complete or previous.completed_by<>actor)) or coalesce(previous.revision,0) <> p_expected_revision then
  result := jsonb_build_object('conflict',true,'record',case when previous.day is null then null else to_jsonb(previous) end);
 else
  insert into public.tkb_tasks(day,owner,task_id,completed,completed_at,completed_by,note,revision,updated_at)
  values(p_day,p_owner,p_task,p_complete,case when p_complete then least(p_changed_at,now()) else null end,
    case when p_complete then actor else null end,case when p_complete then p_note else null end,
    coalesce(previous.revision,0)+1,now())
  on conflict(day,owner,task_id) do update set completed=excluded.completed,completed_at=excluded.completed_at,
    completed_by=excluded.completed_by,note=excluded.note,revision=excluded.revision,updated_at=excluded.updated_at
  returning * into saved;
  result := jsonb_build_object('conflict',false,'record',to_jsonb(saved));
 end if;
 insert into tkb_private.operations values(auth.uid(),p_operation_id,result);
 return result;
end $$;
revoke all on function public.tkb_set_task(date,text,text,boolean,text,uuid,bigint,timestamptz) from public,anon;
grant execute on function public.tkb_set_task(date,text,text,boolean,text,uuid,bigint,timestamptz) to authenticated;

-- Import only the signed-in child's pre-sync local completions. Existing cloud records win.
create or replace function public.tkb_import_task(p_day date,p_owner text,p_task text,p_completed_at timestamptz,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor text := tkb_private.viewer_role();
begin
 if actor is null or actor='parents' or (p_owner<>'shared' and p_owner<>actor) then
  raise exception 'Not allowed' using errcode='42501'; end if;
 if p_day is null or p_owner is null or p_task is null or p_completed_at is null
   or not tkb_private.valid_task(p_owner,p_task,p_day)
   or p_day<>(p_completed_at at time zone 'Asia/Ho_Chi_Minh')::date or p_completed_at>now()
   or (p_note is not null and (p_note<>'không có' or p_owner='shared' or p_task not in ('extra-homework','sm-homework')))
 then raise exception 'Invalid import'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_day::text || ':' || p_owner || ':' || p_task,0));
 insert into public.tkb_tasks(day,owner,task_id,completed,completed_at,completed_by,note)
 values(p_day,p_owner,p_task,true,p_completed_at,actor,p_note) on conflict do nothing;
end $$;
revoke all on function public.tkb_import_task(date,text,text,timestamptz,text) from public,anon;
grant execute on function public.tkb_import_task(date,text,text,timestamptz,text) to authenticated;

-- Return only aggregate ranking data, so children never receive each other's task details.
create or replace function public.tkb_leaderboard(p_from date,p_to date)
returns table(
 student text,private_done bigint,private_expected bigint,shared_done bigint,
 completion_points bigint,shared_points bigint,early_bonus bigint,
 perfect_days bigint,consistency_points bigint,score bigint
)
language plpgsql stable security definer set search_path='' as $$
begin
 if tkb_private.viewer_role() is null then raise exception 'Not allowed' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to>(now() at time zone 'Asia/Ho_Chi_Minh')::date
   or p_to-p_from>62 then raise exception 'Invalid leaderboard range'; end if;
 return query
 with children(student) as (values ('khoi'::text),('nhan'::text)),
 days(day) as (select value::date from generate_series(p_from,p_to,interval '1 day') value where extract(isodow from value)<6),
 daily as (
  select c.student,d.day,(select count(*) from (select task_id from public.tkb_task_catalog where owner=c.student union select task_id from public.tkb_daily_catalog where owner=c.student and day=d.day) ids where tkb_private.valid_task(c.student,ids.task_id,d.day)) as expected,
   count(t.task_id) filter(where t.owner=c.student)::bigint as private_done,
   count(t.task_id) filter(where t.owner='shared')::bigint as shared_done,
   least(15,coalesce(sum(case when t.note is null then case
    when (t.completed_at at time zone 'Asia/Ho_Chi_Minh')::time<time '19:00' then 3
    when (t.completed_at at time zone 'Asia/Ho_Chi_Minh')::time<time '20:00' then 2
    when (t.completed_at at time zone 'Asia/Ho_Chi_Minh')::time<time '21:00' then 1
    else 0 end else 0 end),0))::bigint as early_bonus
  from days d cross join children c
  left join public.tkb_tasks t on t.day=d.day and t.completed and
   (t.owner=c.student or (t.owner='shared' and t.completed_by=c.student)) and tkb_private.valid_task(t.owner,t.task_id,d.day)
  group by c.student,d.day
 ), scored as (
  select d.*,coalesce(round(60.0*d.private_done/nullif(d.expected,0)),0)::bigint as completion_points,
   d.shared_done*10 as shared_points,
   case when d.expected>0 and d.private_done=d.expected then 10 else 0 end::bigint as consistency_points
  from daily d
 )
 select s.student,sum(s.private_done)::bigint,sum(s.expected)::bigint,sum(s.shared_done)::bigint,
  sum(s.completion_points)::bigint,sum(s.shared_points)::bigint,sum(s.early_bonus)::bigint,
  count(*) filter(where s.expected>0 and s.private_done=s.expected)::bigint,sum(s.consistency_points)::bigint,
  sum(s.completion_points+s.shared_points+s.early_bonus+s.consistency_points)::bigint
 from scored s group by s.student order by 10 desc,s.student;
end $$;
revoke all on function public.tkb_leaderboard(date,date) from public,anon;
grant execute on function public.tkb_leaderboard(date,date) to authenticated;

-- Only the login function's service credential can consume rate-limit buckets.
create table if not exists tkb_private.login_attempts (
 bucket text primary key, started_at timestamptz not null, attempts integer not null
);
revoke all on tkb_private.login_attempts from public,anon,authenticated;
create or replace function public.tkb_login_attempt(p_bucket text) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_bucket is null or length(p_bucket)<>64 then return false; end if;
 insert into tkb_private.login_attempts as a values(p_bucket,now(),1)
 on conflict(bucket) do update set
 attempts=case when a.started_at<now()-interval '15 minutes' then 1 else a.attempts+1 end,
 started_at=case when a.started_at<now()-interval '15 minutes' then now() else a.started_at end
 returning attempts into n;
 delete from tkb_private.login_attempts where started_at<now()-interval '1 day';
 return n<=30;
end $$;
revoke all on function public.tkb_login_attempt(text) from public,anon,authenticated;
grant execute on function public.tkb_login_attempt(text) to service_role;

-- Automatic grants are disabled for this project; grant administration explicitly.
grant all on public.tkb_profiles,public.tkb_timetables,public.tkb_tasks,public.tkb_parent_notes,public.tkb_snack_fund to service_role;
