-- Transactional integration test: no fixture or completion survives rollback.
begin;
do $$
declare parent_id uuid; khoi_id uuid; nhan_id uuid; d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; o text; n integer;
begin
 select user_id into parent_id from public.tkb_profiles where role='parents';
 select user_id into khoi_id from public.tkb_profiles where role='khoi';
 select user_id into nhan_id from public.tkb_profiles where role='nhan';
 perform set_config('request.jwt.claim.sub',parent_id::text,true);
 foreach o in array array['shared','khoi','nhan'] loop
  perform public.tkb_save_catalog(o,'test-catalog-transaction','Công việc kiểm thử',false,0);
  assert tkb_private.valid_task(o,'test-catalog-transaction',d);
  assert not tkb_private.valid_task(o,'test-catalog-transaction',d-1);
  perform public.tkb_save_catalog(o,'test-catalog-transaction','Đã sửa',false,1);
  begin
   perform public.tkb_save_catalog(o,'test-catalog-transaction','Ghi đè sai',false,1);
   raise exception 'Stale revision accepted';
  exception when serialization_failure then null; end;
  perform public.tkb_save_catalog(o,'test-catalog-transaction','',true,2);
  assert not tkb_private.valid_task(o,'test-catalog-transaction',d);
 end loop;
 -- Historical membership survives removing an existing task today.
 select revision into n from public.tkb_task_catalog where owner='shared' and task_id='fish';
 perform public.tkb_save_catalog('shared','fish','',true,n);
 assert tkb_private.valid_task('shared','fish',d-1);
 assert not tkb_private.valid_task('shared','fish',d);
 perform * from public.tkb_leaderboard(d-7,d);

 foreach o in array array['shared','khoi','nhan'] loop
  perform public.tkb_save_daily_catalog('2026-09-21',o,'test-day-only','Chỉ thứ Hai',false,0);
  assert tkb_private.valid_task(o,'test-day-only','2026-09-21');
  assert not tkb_private.valid_task(o,'test-day-only','2026-09-22');
  perform public.tkb_save_daily_catalog('2026-09-21',o,'test-day-only','Đổi tên',false,1);
  begin
   perform public.tkb_save_daily_catalog('2026-09-21',o,'test-day-only','Sai revision',false,1);
   raise exception 'Stale daily revision accepted';
  exception when serialization_failure then null; end;
  perform public.tkb_save_daily_catalog('2026-09-21',o,'test-day-only','Đổi tên',true,2);
  assert not tkb_private.valid_task(o,'test-day-only','2026-09-21');
  perform public.tkb_save_daily_catalog('2026-09-28',o,'test-future-day','Chỉ ngày tương lai',false,0);
  assert tkb_private.valid_task(o,'test-future-day','2026-09-28');
  assert not tkb_private.valid_task(o,'test-future-day','2026-09-29');
 end loop;
 perform public.tkb_save_daily_catalog('2026-09-21','khoi','bath','Nghỉ tắm ngày này',true,0);
 assert not tkb_private.valid_task('khoi','bath','2026-09-21');
 assert tkb_private.valid_task('khoi','bath','2026-09-22');
 assert (select private_expected from public.tkb_leaderboard('2026-09-21','2026-09-21') where student='khoi')=5;
 assert (select private_expected from public.tkb_leaderboard('2026-09-22','2026-09-22') where student='khoi')=6;
 perform set_config('request.jwt.claim.sub',khoi_id::text,true);
 begin
  perform public.tkb_save_daily_catalog('2026-09-21','khoi','test-child-denied','Không được phép',false,0);
  raise exception 'Child daily write accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.tkb_save_catalog('khoi','test-child-denied','Không được phép',false,0);
  raise exception 'Child write accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',nhan_id::text,true);
 begin
  perform public.tkb_save_catalog('shared','test-child-denied','Không được phép',false,0);
  raise exception 'Child write accepted';
 exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from public.tkb_profiles where role='nhan'),true);
-- Existing claim remains Nhan, RLS must exclude Khoi private catalog.
do $$ begin assert not exists(select 1 from public.tkb_task_catalog where owner='khoi'); assert not exists(select 1 from public.tkb_daily_catalog where owner='khoi'); assert not exists(select 1 from jsonb_array_elements(public.tkb_catalog_entries()) x where x->>'owner'='khoi'); end $$;
rollback;
