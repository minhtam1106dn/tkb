(() => {
 'use strict';
 const config=window.TKB_CONFIG;
 const sessionKey=`tkb-session:v1:${new URL(config.url).hostname}`;
 let session=null,profile=null,activeDay=null,generation=0,status='',timer=null,warmed=false;
 let state={days:{},queue:[]},storageKey='',refreshing=null,flushing=null,pulling=null;
 const listeners=new Set();
 const emit=()=>listeners.forEach(fn=>fn());
 const empty=()=>({days:{},queue:[],leaderboards:{},notes:{}});
 function savedSession(){
  try{
   const saved=JSON.parse(localStorage.getItem(sessionKey));
   return saved && ['khoi','nhan','parents'].includes(saved.role) && saved.refresh_token && saved.user?.id?saved:null;
  }catch(_){return null;}
 }
 function persistSession(){
  if(!session || !profile)return;
  try{localStorage.setItem(sessionKey,JSON.stringify({role:profile.role,user:{id:profile.id},refresh_token:session.refresh_token}));}
  catch(_){status='Trình duyệt không lưu được phiên đăng nhập';emit();}
 }
 function load(){
  const raw=localStorage.getItem(storageKey);
  const next=raw?JSON.parse(raw):empty();
  if(!next || !next.days || !Array.isArray(next.queue))throw new Error('Không đọc được dữ liệu trên thiết bị.');
  if(!next.leaderboards || typeof next.leaderboards!=='object')next.leaderboards={};
  if(!next.notes || typeof next.notes!=='object')next.notes={};
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
    const renew=async()=>{
     const latest=savedSession();
     const refreshToken=latest?.user.id===profile?.id?latest.refresh_token:token;
     const r=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:refreshToken});
     if(!r.ok)throw new Error('Phiên đăng nhập đã hết hạn. Hãy chọn Đổi người xem để đăng nhập lại.');
     const next=await r.json();
     if(version!==generation)throw new Error('Người dùng đã thay đổi.');
     session=next;persistSession();
    };
    return navigator.locks?navigator.locks.request(sessionKey,renew):renew();
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
 function rowsBetween(from,to){
  const rows=new Map();
  for(const [day,items] of Object.entries(state.days)){
   if(day<from || day>to)continue;
   for(const row of items)rows.set(`${day}:${row.owner}:${row.task_id}`,row);
  }
  for(const operation of state.queue){
   if(operation.p_day<from || operation.p_day>to)continue;
   rows.set(`${operation.p_day}:${operation.p_owner}:${operation.p_task}`,{
    day:operation.p_day,owner:operation.p_owner,task_id:operation.p_task,
    completed:operation.p_complete,completed_at:operation.p_complete?operation.p_changed_at:null,
    completed_by:operation.p_complete?profile?.role:null,note:operation.p_complete?operation.p_note:null,
    revision:operation.p_expected_revision+1,pending:true
   });
  }
  return [...rows.values()];
 }
 function failure(error){status=navigator.onLine?error.message:'Mất mạng · Thay đổi đang chờ đồng bộ';emit();}
 async function pull(day=activeDay){
  if(!profile || !day || !navigator.onLine)return;
  const version=generation;
  const [rows,notes]=await Promise.all([
   api(`/rest/v1/tkb_tasks?day=eq.${encodeURIComponent(day)}&select=*`),
   api(`/rest/v1/tkb_parent_notes?day=eq.${encodeURIComponent(day)}&select=day,child,message,updated_at`)
  ]);
  await lock(()=>{
   if(version!==generation)return;
   load();for(const row of rows)cacheRow(row);
   for(const child of ['khoi','nhan'])delete state.notes[`${day}:${child}`];
   for(const note of notes)state.notes[`${note.day}:${note.child}`]=note;
   persist();
   status=state.queue.length?'Đang chờ đồng bộ':'Đã đồng bộ';
  });
  if(version===generation)emit();
 }
 async function loadRange(from,to){
  if(!profile || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from>to)
   throw new Error('Khoảng ngày không hợp lệ.');
  const span=(Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000;
  if(span>62)throw new Error('Khoảng thống kê quá dài.');
  if(!navigator.onLine)return rowsBetween(from,to);
  const version=generation;
  const rows=await api(`/rest/v1/tkb_tasks?day=gte.${encodeURIComponent(from)}&day=lte.${encodeURIComponent(to)}&select=*`);
  await lock(()=>{
   if(version!==generation)return;
   load();for(const row of rows)cacheRow(row);persist();
  });
  if(version!==generation)return [];
  emit();return rowsBetween(from,to);
 }
 async function loadLeaderboard(from,to){
  if(!profile || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from>to)
   throw new Error('Khoảng xếp hạng không hợp lệ.');
  const cacheKey=`${from}:${to}`;
  if(!navigator.onLine){
   const cached=state.leaderboards[cacheKey];
   if(cached)return cached;
   throw new Error('Cần kết nối mạng để tải xếp hạng lần đầu.');
  }
  const version=generation;
  const rows=await api('/rest/v1/rpc/tkb_leaderboard',{p_from:from,p_to:to});
  await lock(()=>{if(version===generation){load();state.leaderboards[cacheKey]=rows;persist();}});
  return version===generation?rows:[];
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
    window.dispatchEvent(new Event('tkb-ranking-change'));
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
 async function activate(role,next,bootstrap){
  const requestedDay=activeDay;
  generation++;session=next;
  try{
   profile={role,id:next.user.id};
   storageKey=`tkb-cloud:v1:${new URL(config.url).hostname}:${profile.id}`;
   load();
   let schedules,rows,notes=[];
   if(bootstrap){
    schedules=bootstrap.schedules;rows=bootstrap.tasks;
    notes=bootstrap.notes||[];
   }else{
    const [profiles,loadedSchedules,loadedRows,loadedNotes]=await Promise.all([
     api('/rest/v1/tkb_profiles?select=role'),
     api('/rest/v1/tkb_timetables?select=student,days'),
     requestedDay?api(`/rest/v1/tkb_tasks?day=eq.${encodeURIComponent(requestedDay)}&select=*`):Promise.resolve([]),
     requestedDay?api(`/rest/v1/tkb_parent_notes?day=eq.${encodeURIComponent(requestedDay)}&select=day,child,message,updated_at`):Promise.resolve([]),
    ]);
    if(profiles.length!==1 || profiles[0].role!==role)throw new Error('Tài khoản chưa được cấu hình đúng quyền.');
    schedules=loadedSchedules;rows=loadedRows;notes=loadedNotes;
   }
   if(rows.length || notes.length)await lock(()=>{load();for(const row of rows)cacheRow(row);for(const note of notes)state.notes[`${note.day}:${note.child}`]=note;persist();});
   status=state.queue.length?'Đang đồng bộ':'Đã đồng bộ';
   persistSession();
   clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)sync();},5000);
   emit();
   const version=generation;
   setTimeout(()=>{if(version===generation)importLocal().then(sync).catch(error=>{if(version===generation)failure(error);});},0);
   return {role,schedules};
  }catch(error){logout();throw error;}
 }
 async function login(role,password){
  const r=await request('/functions/v1/tkb-login',{role,password,day:activeDay});
  if(!r.ok)throw new Error(r.status===401?'Mật khẩu chưa đúng.':r.status===429?'Bạn đã thử nhiều lần. Vui lòng thử lại sau 15 phút.':'Không thể đăng nhập. Kiểm tra mạng rồi thử lại.');
  const next=await r.json();
  if(!next.access_token || !next.refresh_token || !next.user?.id)throw new Error('Phản hồi đăng nhập không hợp lệ.');
  const bootstrap=next.bootstrap?.role===role && next.bootstrap.day===activeDay?next.bootstrap:null;
  return activate(role,next,bootstrap);
 }
 async function restore(){
  const saved=savedSession();
  if(!saved || !navigator.onLine)return null;
  try{
   const renew=async()=>{
    const latest=savedSession();
    if(!latest)return null;
    const r=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:latest.refresh_token});
    if(r.status===400 || r.status===401){localStorage.removeItem(sessionKey);return null;}
    if(!r.ok)throw new Error('Chưa khôi phục được phiên đăng nhập.');
    const next=await r.json();
    if(next.user?.id!==latest.user.id){localStorage.removeItem(sessionKey);return null;}
    return {role:latest.role,session:next};
   };
   const result=navigator.locks?await navigator.locks.request(sessionKey,renew):await renew();
   if(!result)return null;
   return await activate(result.role,result.session,null);
  }catch(error){return null;}
 }
 function logout(){
  const token=session?.access_token;
  generation++;session=null;profile=null;state=empty();clearInterval(timer);timer=null;status='';
  try{localStorage.removeItem(sessionKey);}catch(_){}
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
 async function saveParentNote(day,child,message){
  if(profile?.role!=='parents' || !['khoi','nhan'].includes(child))throw new Error('Chỉ Ba Mẹ được lưu lời nhắn.');
  const clean=message.trim();
  if(clean.length>500)throw new Error('Lời nhắn tối đa 500 ký tự.');
  const saved=await api('/rest/v1/rpc/tkb_set_parent_note',{p_day:day,p_child:child,p_message:clean});
  await lock(()=>{load();const key=`${day}:${child}`;if(clean)state.notes[key]=saved;else delete state.notes[key];persist();});
  emit();return saved;
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
 window.TKBCloud={login,restore,logout,save,saveParentNote,sync,warmup,loadRange,loadLeaderboard,
  get role(){return profile?.role;},get status(){return status;},
  getRows(from,to){return profile?rowsBetween(from,to):[];},
  getParentNote(day,child){return profile?state.notes[`${day}:${child}`]||null:null;},
  getCompletion(day,owner,id){if(!profile)return null;const r=viewRow(day,owner,id);return r?.completed?{completedAt:r.completed_at,completedBy:r.completed_by,note:r.note,pending:!!r.pending}:null;},
  watchDate(day){if(day===activeDay)return;activeDay=day;if(profile)pull(day).catch(failure);},
  subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
 };
 window.addEventListener('online',sync);
 window.addEventListener('offline',()=>{if(profile){status='Mất mạng · Thay đổi sẽ đồng bộ khi có mạng';emit();}});
 window.addEventListener('focus',sync);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
 window.addEventListener('storage',event=>{if(profile && event.key===storageKey){try{load();emit();}catch(error){failure(error);}}});
 window.addEventListener('storage',event=>{if(event.key===sessionKey && profile){if(!event.newValue)logout();else{const latest=savedSession();if(latest?.user.id===profile.id)session={...session,...latest};}}});
})();
