begin;
do $$
declare parent_id uuid; child_id uuid; original jsonb; before_days jsonb; result public.tkb_timetables%rowtype;
 sample jsonb:='{"school":[["Toán <b>","Cô Lan"],null,["Ngữ văn",""]],"second":[["Mỹ thuật",""]],"secondStart":2,"extra":[["16:00","17:30","Tiếng Anh"]]}'::jsonb;
begin
 select user_id into parent_id from public.tkb_profiles where role='parents';
 select user_id into child_id from public.tkb_profiles where role='khoi';
 perform set_config('request.jwt.claim.sub',parent_id::text,true);
 select days into before_days from public.tkb_timetables where student='khoi';original:=before_days->0;
 result:=public.tkb_save_timetable_day('khoi',0,sample,original);
 assert result.days->0->'school'=sample->'school';
 assert result.days->1=before_days->1;
 assert result.days->0->>'name'='Thứ Hai';
 begin
  perform public.tkb_save_timetable_day('khoi',0,sample,original);
  assert false,'Stale timetable accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.tkb_save_timetable_day('khoi',0,jsonb_set(sample,'{extra}','[["18:00","17:00","Sai giờ"]]'::jsonb),result.days->0);
  assert false,'Invalid time accepted';
 exception when raise_exception then null; end;
 begin
  perform public.tkb_save_timetable_day('khoi',0,jsonb_set(sample,'{school}','[42]'::jsonb),result.days->0);
  assert false,'Malformed lesson accepted';
 exception when raise_exception then null; end;
 result:=public.tkb_save_timetable_day('khoi',6,sample,before_days->6);
 assert jsonb_array_length(result.days)=7;
 assert result.days->6->>'name'='Chủ nhật';
 perform set_config('request.jwt.claim.sub',child_id::text,true);
 begin
  perform public.tkb_save_timetable_day('khoi',0,sample,result.days->0);
  assert false,'Child edit accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.tkb_save_timetable_day('nhan',0,sample,null);
  assert false,'Anonymous edit accepted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
