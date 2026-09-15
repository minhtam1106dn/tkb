(() => {
 'use strict';
 const config=window.TKB_CONFIG;
 let session=null,profile=null,activeDay=null,generation=0,status='',timer=null,warmed=false;
 let state={days:{},queue:[]},storageKey='',refreshing=null,flushing=null,pulling=null;
 const listeners=new Set();
 const emit=()=>listeners.forEach(fn=>fn());
 const empty=()=>({days:{},queue:[]});
 function load(){
  const raw=localStorage.getItem(storageKey);
  const next=raw?JSON.parse(raw):empty();
  if(!next || !next.days || !Array.isArray(next.queue))throw new Error('Không đọc được dữ liệu trên thiết bị.');
  state=next;
 }
 function persist(){localStorage.setItem(storageKey,JSON.stringify(state));}
 function lock(fn){return navigator.locks?navigator.locks.request(storageKey,fn):Promise.resolve().then(fn);}
 async function request(path,body,token){
  return fetch(config.url+path,{method:body?'POST':'GET',headers:{apikey:config.anonKey,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(12000)});
 }
 async function refresh(){
  if(!session)throw new Error('Vui lòng đăng nhập lại.');
  if(!refreshing){
   const version=generation,token=session.refresh_token;
   refreshing=(async()=>{
    const r=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:token});
    if(!r.ok)throw new Error('Phiên đăng nhập đã hết hạn. Hãy chọn Đổi người xem để đăng nhập lại.');
    const next=await r.json();
    if(version!==generation)throw new Error('Người dùng đã thay đổi.');
    session=next;
   })().finally(()=>{refreshing=null;});
  }
  return refreshing;
 }
 async function api(path,body,retry=true){
  if(!session)throw new Error('Vui lòng đăng nhập.');
  const version=generation;
  const r=await request(path,body,session.access_token);
  if(version!==generation)throw new Error('Người dùng đã thay đổi.');
  if(r.status===401 && retry){await refresh();return api(path,body,false);}
  if(!r.ok){const e=new Error(r.status===403?'Tài khoản không được phép sửa mục này.':'Chưa đồng bộ được. Hệ thống sẽ thử lại.');e.httpStatus=r.status;throw e;}
  const text=await r.text();return text?JSON.parse(text):null;
 }
 function cacheRow(row){
  const rows=state.days[row.day] ||= [];
  const i=rows.findIndex(r=>r.owner===row.owner && r.task_id===row.task_id);
  if(i<0)rows.push(row);else if(rows[i].revision<=row.revision)rows[i]=row;
 }
 function viewRow(day,owner,id){
  let row=(state.days[day]||[]).find(r=>r.owner===owner && r.task_id===id);
  for(const o of state.queue.filter(o=>o.p_day===day && o.p_owner===owner && o.p_task===id)){
   row={day,owner,task_id:id,completed:o.p_complete,completed_at:o.p_complete?o.p_changed_at:null,
    completed_by:o.p_complete?profile.role:null,note:o.p_note,revision:o.p_expected_revision+1,pending:true};
  }
  return row;
 }
 function failure(error){status=navigator.onLine?error.message:'Mất mạng · Thay đổi đang chờ đồng bộ';emit();}
 async function pull(day=activeDay){
  if(!profile || !day || !navigator.onLine)return;
  const version=generation;
  const rows=await api(`/rest/v1/tkb_tasks?day=eq.${encodeURIComponent(day)}&select=*`);
  await lock(()=>{
   if(version!==generation)return;
   load();for(const row of rows)cacheRow(row);persist();
   status=state.queue.length?'Đang chờ đồng bộ':'Đã đồng bộ';
  });
  if(version===generation)emit();
 }
 async function flush(){
  if(flushing)return flushing;
  if(!profile || !navigator.onLine)return;
  const version=generation;
  flushing=lock(async()=>{
   if(version!==generation)return;
   load();
   while(state.queue.length && version===generation){
    const operation=state.queue[0];
    const result=await api('/rest/v1/rpc/tkb_set_task',operation);
    if(version!==generation)return;
    if(result.record)cacheRow(result.record);
    state.queue=state.queue.filter(o=>o.p_operation_id!==operation.p_operation_id && !(result.conflict && o.p_day===operation.p_day && o.p_owner===operation.p_owner && o.p_task===operation.p_task));
    persist();
    if(result.conflict)window.dispatchEvent(new CustomEvent('tkb-conflict',{detail:'Mục này đã thay đổi trên thiết bị khác. Đã lấy trạng thái mới nhất.'}));
    status=state.queue.length?'Đang đồng bộ':'Đã đồng bộ';emit();
   }
  }).catch(error=>{if(version===generation)failure(error);}).finally(()=>{flushing=null;});
  return flushing;
 }
 async function sync(){
  if(pulling || !profile || !navigator.onLine)return;
  const version=generation;
  pulling=(async()=>{await flush();await pull();})().catch(error=>{if(version===generation)failure(error);}).finally(()=>{pulling=null;});
  return pulling;
 }
 function warmup(){
  if(warmed || !navigator.onLine)return;
  warmed=true;
  fetch(`${config.url}/functions/v1/tkb-login`,{method:'OPTIONS',headers:{apikey:config.anonKey},cache:'no-store',signal:AbortSignal.timeout(4000)})
   .catch(()=>{warmed=false;});
 }
 async function login(role,password){
  const requestedDay=activeDay;
  const r=await request('/functions/v1/tkb-login',{role,password,day:requestedDay});
  if(!r.ok)throw new Error(r.status===401?'Mật khẩu chưa đúng.':r.status===429?'Bạn đã thử nhiều lần. Vui lòng thử lại sau 15 phút.':'Không thể đăng nhập. Kiểm tra mạng rồi thử lại.');
  const next=await r.json();
  if(!next.access_token || !next.user?.id)throw new Error('Phản hồi đăng nhập không hợp lệ.');
  generation++;session=next;
  try{
   const bootstrap=next.bootstrap?.role===role && next.bootstrap.day===requestedDay?next.bootstrap:null;
   profile={role,id:next.user.id};
   storageKey=`tkb-cloud:v1:${new URL(config.url).hostname}:${profile.id}`;
   load();
   let schedules,rows;
   if(bootstrap){
    schedules=bootstrap.schedules;rows=bootstrap.tasks;
   }else{
    const [profiles,loadedSchedules,loadedRows]=await Promise.all([
     api('/rest/v1/tkb_profiles?select=role'),
     api('/rest/v1/tkb_timetables?select=student,days'),
     requestedDay?api(`/rest/v1/tkb_tasks?day=eq.${encodeURIComponent(requestedDay)}&select=*`):Promise.resolve([]),
    ]);
    if(profiles.length!==1 || profiles[0].role!==role)throw new Error('Tài khoản chưa được cấu hình đúng quyền.');
    schedules=loadedSchedules;rows=loadedRows;
   }
   if(rows.length)await lock(()=>{load();for(const row of rows)cacheRow(row);persist();});
   status=state.queue.length?'Đang đồng bộ':'Đã đồng bộ';
   clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)sync();},5000);
   emit();
   const version=generation;
   setTimeout(()=>{if(version===generation)importLocal().then(sync).catch(error=>{if(version===generation)failure(error);});},0);
   return {role,schedules};
  }catch(error){logout();throw error;}
 }
 function logout(){
  const token=session?.access_token;
  generation++;session=null;profile=null;state=empty();clearInterval(timer);timer=null;status='';
  // Access and refresh tokens stay in memory, never in the public source or persistent cache.
  if(token)fetch(config.url+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)}).catch(()=>{});
  emit();
 }
 async function save(day,owner,id,complete,note,expected){
  const actor=profile?.role,version=generation;
  if(!actor || actor==='parents' || (owner!=='shared' && owner!==actor))throw new Error('Không có quyền sửa mục này.');
  await lock(()=>{
   if(version!==generation)return;
   load();const previous=viewRow(day,owner,id);
   if(owner==='shared' && previous?.completed && (complete || previous.completed_by!==actor || previous.completed_at!==expected))throw new Error('Mục đã thay đổi. Chỉ người hoàn thành mới được bỏ tích.');
   const operation={p_day:day,p_owner:owner,p_task:id,p_complete:complete,p_note:complete?(note||null):null,
    p_operation_id:crypto.randomUUID(),p_expected_revision:previous?.revision||0,p_changed_at:new Date().toISOString()};
   state.queue.push(operation);
   try{persist();}catch(error){load();throw new Error('Chưa lưu được thay đổi trên thiết bị.');}
   status=navigator.onLine?'Đang đồng bộ':'Mất mạng · Thay đổi đang chờ đồng bộ';emit();
  });
  if(version===generation)void flush();
 }
 async function importLocal(){
  if(profile.role==='parents')return;
  const actor=profile.role,version=generation,marker=storageKey+':imported';
  if(localStorage.getItem(marker))return;
  const shared=new Set(['kitchen','garage','floor-2','leaves','trash','plants','table','laundry','stairs','fish']);
  const personal=new Set(['bath','uniform','school-homework','sm-homework','prepare',...(actor==='khoi'?['extra-homework']:[])]);
  for(const key of Object.keys(localStorage)){
   if(version!==generation)return;
   const m=key.match(/^tkb-checklist:v1:(\d{4}-\d{2}-\d{2}):(shared|khoi|nhan):(.+)$/);
   if(!m || (m[2]!=='shared' && m[2]!==actor))continue;
   let item;try{item=JSON.parse(localStorage.getItem(key));}catch(_){continue;}
   if(!item || item.completedBy!==actor || !Number.isFinite(Date.parse(item.completedAt)) || !(m[2]==='shared'?shared:personal).has(m[3]))continue;
   await api('/rest/v1/rpc/tkb_import_task',{p_day:m[1],p_owner:m[2],p_task:m[3],p_completed_at:item.completedAt,p_note:item.note||null});
  }
  if(version===generation)localStorage.setItem(marker,'1');
 }
 window.TKBCloud={login,logout,save,sync,warmup,
  get role(){return profile?.role;},get status(){return status;},
  getCompletion(day,owner,id){if(!profile)return null;const r=viewRow(day,owner,id);return r?.completed?{completedAt:r.completed_at,completedBy:r.completed_by,note:r.note,pending:!!r.pending}:null;},
  watchDate(day){if(day===activeDay)return;activeDay=day;if(profile)pull(day).catch(failure);},
  subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
 };
 window.addEventListener('online',sync);
 window.addEventListener('offline',()=>{if(profile){status='Mất mạng · Thay đổi sẽ đồng bộ khi có mạng';emit();}});
 window.addEventListener('focus',sync);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
 window.addEventListener('storage',event=>{if(profile && event.key===storageKey){try{load();emit();}catch(error){failure(error);}}});
})();
