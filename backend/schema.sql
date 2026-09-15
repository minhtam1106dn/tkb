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

create table if not exists tkb_private.operations (
 user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 result jsonb not null,
 primary key(user_id,operation_id)
);
revoke all on tkb_private.operations from public, anon, authenticated;

create or replace function tkb_private.valid_task(p_owner text,p_task text) returns boolean
language sql immutable set search_path = '' as $$
 select case when p_owner = 'shared' then p_task = any(array[
 'kitchen','garage','floor-2','leaves','trash','plants','table','laundry','stairs','fish'])
 when p_owner = 'khoi' then p_task = any(array['bath','uniform','school-homework','extra-homework','sm-homework','prepare'])
 when p_owner = 'nhan' then p_task = any(array['bath','uniform','school-homework','sm-homework','prepare']) else false end
$$;
revoke all on function tkb_private.valid_task(text,text) from public;

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
   or not tkb_private.valid_task(p_owner,p_task) then raise exception 'Invalid task'; end if;
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
   or not tkb_private.valid_task(p_owner,p_task)
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
 with children(student,expected) as (values ('khoi'::text,6),('nhan'::text,5)),
 days(day) as (select generate_series(p_from,p_to,interval '1 day')::date),
 daily as (
  select c.student,d.day,c.expected,
   count(t.task_id) filter(where t.owner=c.student)::bigint as private_done,
   count(t.task_id) filter(where t.owner='shared')::bigint as shared_done,
   least(15,coalesce(sum(case when t.note is null then case
    when (t.completed_at at time zone 'Asia/Ho_Chi_Minh')::time<time '18:00' then 3
    when (t.completed_at at time zone 'Asia/Ho_Chi_Minh')::time<time '20:00' then 2
    when (t.completed_at at time zone 'Asia/Ho_Chi_Minh')::time<time '21:00' then 1
    else 0 end else 0 end),0))::bigint as early_bonus
  from days d cross join children c
  left join public.tkb_tasks t on t.day=d.day and t.completed and
   (t.owner=c.student or (t.owner='shared' and t.completed_by=c.student))
  group by c.student,d.day,c.expected
 ), scored as (
  select d.*,round(60.0*d.private_done/d.expected)::bigint as completion_points,
   d.shared_done*10 as shared_points,
   case when d.private_done=d.expected then 10 else 0 end::bigint as consistency_points
  from daily d
 )
 select s.student,sum(s.private_done)::bigint,sum(s.expected)::bigint,sum(s.shared_done)::bigint,
  sum(s.completion_points)::bigint,sum(s.shared_points)::bigint,sum(s.early_bonus)::bigint,
  count(*) filter(where s.private_done=s.expected)::bigint,sum(s.consistency_points)::bigint,
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
grant all on public.tkb_profiles,public.tkb_timetables,public.tkb_tasks to service_role;
