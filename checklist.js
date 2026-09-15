(() => {
 'use strict';
 const commonTasks = [
  ['kitchen','Quét và lau khu bếp'], ['garage','Quét và lau nhà để xe'],
  ['floor-2','Quét nhà tầng 2'], ['leaves','Lượm lá trước sân'],
  ['trash','Vứt rác'], ['plants','Tưới cây'], ['table','Lau bàn'],
  ['laundry','Phơi đồ trên tầng 3'],
  ['stairs','Lượm rác cầu thang'], ['fish','Cho cá ăn']
 ];
 const privateTasks = [
  ['bath','Tắm rửa'], ['uniform','Giặt đồ đi học'],
  ['school-homework','Làm bài tập trên trường'], ['extra-homework','Làm bài tập học thêm'],
  ['sm-homework','Làm bài tập ở SM'], ['prepare','Soạn thời khóa biểu']
 ];
 const optionalTasks=new Set(['extra-homework','sm-homework']);
 window.TKB_TASKS={common:commonTasks,private:privateTasks,optional:optionalTasks};
 function taskGroups() {
  const personal=privateTasks.filter(([id])=>selectedStudent!=='nhan' || id!=='extra-homework');
  return [['common-tasks','shared',commonTasks],['private-tasks',selectedStudent,personal]];
 }
 const prefix = 'tkb-checklist:v1:';
 const zone = 'Asia/Ho_Chi_Minh';
 const dateFormat = new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
 const timeFormat = new Intl.DateTimeFormat('vi-VN',{timeZone:zone,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
 function today() {
  const parts = Object.fromEntries(dateFormat.formatToParts(new Date()).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
 }
 let lastToday = today();
 let selectedDate = lastToday;
 let selectedView = 'dashboard';
 const byId = id => document.getElementById(id);
 const keyFor = (owner,id) => `${prefix}${selectedDate}:${owner}:${id}`;
 function getCompletion(owner,id) {
  if(window.TKBCloud)return window.TKBCloud.getCompletion(selectedDate,owner,id);
  const raw = localStorage.getItem(keyFor(owner,id));
  if (!raw) return null;
  const record = JSON.parse(raw);
  if (!record || !Object.hasOwn(students,record.completedBy) ||
      typeof record.completedAt !== 'string' || !Number.isFinite(Date.parse(record.completedAt))) {
   throw new Error('Invalid completion record');
  }
  return record;
 }
 function setView(view) {
  if(!['dashboard','schedule','checklist'].includes(view))return;
  selectedView = view;
  for(const id of ['dashboard','schedule','checklist'])byId(id).hidden=view!==id;
  document.querySelector('.skip').href = `#${view}`;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.view===view)));
  document.querySelector('.students').hidden=currentViewer!=='parents' || view==='dashboard';
  const familyDashboard=view==='dashboard' && currentViewer==='parents';
  byId('student-name').textContent=familyDashboard?'Thanh Khôi & Thanh Nhân':students[selectedStudent].name;
  byId('student-footer').textContent=familyDashboard?'Thanh Khôi & Thanh Nhân':`${students[selectedStudent].name} · Lớp ${students[selectedStudent].className}`;
  try { localStorage.setItem('tkb-view',view); } catch (_) {}
  if (view==='checklist') renderChecklist();
  if (view==='dashboard') window.renderDashboard?.();
 }
 function renderChecklist() {
  const focused=document.activeElement?.matches("input[data-task]")?document.activeElement.id:null;
  window.TKBCloud?.watchDate(selectedDate);
  const student = students[selectedStudent];
  const editable = selectedDate===today() && currentViewer===selectedStudent;
  byId('checklist-date').value = selectedDate;
  byId('private-title').textContent = `Việc riêng · ${student.name.replace('Nguyễn ','')}`;
  const total=taskGroups().reduce((sum,[,,tasks])=>sum+tasks.length,0);
  let completed=0, storageFailed=false;
  for (const [listId,owner,tasks] of taskGroups()) {
   const list = byId(listId);
   list.replaceChildren();
   for (const [id,name] of tasks) {
    let record=null, readFailed=false;
    try { record=getCompletion(owner,id); } catch (_) {storageFailed=true;readFailed=true;}
    if (record) completed++;
    const locked=owner==='shared' && !!record && record.completedBy!==currentViewer;
    const row=document.createElement('li');
    row.className=`task-row ${record?'done':'pending'} ${editable&&!locked?'':'readonly'}`;
    const label=document.createElement('label');label.className='task-label';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=!!record;
    checkbox.disabled=!editable || readFailed || locked;
    if(record)checkbox.dataset.completedAt=record.completedAt;
    checkbox.dataset.owner=owner;checkbox.dataset.task=id;checkbox.id=`task-${owner}-${id}`;
    const copy=document.createElement('span');copy.className='task-copy';
    const title=document.createElement('span');title.className='task-name';title.textContent=name;
    const status=document.createElement('span');status.className='task-status';status.id=`status-${owner}-${id}`;
    checkbox.setAttribute('aria-describedby',status.id);
    if (record) {
     const time=document.createElement('time');time.dateTime=record.completedAt;time.textContent=timeFormat.format(new Date(record.completedAt));
     status.append(record.note==='không có'?'Đã xong · Không có · ':'Đã xong · ',time,` · ${students[record.completedBy].name.replace('Nguyễn ','')}${record.pending?' · Chờ đồng bộ':''}${locked?' · Chỉ xem':''}`);
    } else status.textContent=readFailed?'Không đọc được trạng thái đã lưu':(selectedDate>today()?'Chưa đến ngày thực hiện':'Chưa xong');
    copy.append(title,status);label.append(checkbox,copy);row.append(label);
    if(owner!=='shared' && optionalTasks.has(id) && !record && editable && !readFailed){
     const noHomework=document.createElement('button');
     noHomework.type='button';noHomework.className='no-homework';noHomework.textContent='Không có';
     noHomework.dataset.noHomework=id;noHomework.dataset.owner=owner;noHomework.dataset.task=id;
     noHomework.setAttribute('aria-label',`${name}: không có bài tập hôm nay, đánh dấu đã xong`);
     row.append(noHomework);
    }
    list.append(row);
   }
  }
  byId('checklist-progress').classList.toggle('complete',completed===total);
  byId('checklist-count').textContent=`${completed}/${total} việc đã xong`;
  if(focused){const control=byId(focused);if(control && !control.disabled)control.focus({preventScroll:true});}
  if (storageFailed) {
   byId('checklist-error').textContent='Không đọc được một số dữ liệu trên trình duyệt. Hãy cho phép lưu dữ liệu rồi tải lại; các mục lỗi chưa được thay đổi.';
   byId('checklist-count').textContent='Chưa đọc đủ dữ liệu';
  }
 }
 function rollDate() {
  const next=today();
  if (next===lastToday) return false;
  if(selectedDate===lastToday) selectedDate=next;
  lastToday=next;renderChecklist();return true;
 }
 async function saveTask(input,checked,note){
  if(rollDate() || selectedDate!==today() || currentViewer!==selectedStudent){renderChecklist();return;}
  const owner=input.dataset.owner,id=input.dataset.task;
  const group=taskGroups().find(([,candidate])=>candidate===owner);
  const task=group?.[2].find(([candidate])=>candidate===id);
  if(!task || (note && (owner==='shared' || !optionalTasks.has(id)))){renderChecklist();return;}
  const actor=currentViewer,day=selectedDate,expectedCompletedAt=input.dataset.completedAt;
  const key=keyFor(owner,id);
  input.disabled=true;
  byId('checklist-error').textContent='';
  try {
   if(window.TKBCloud){
    await window.TKBCloud.save(day,owner,id,checked,note,expectedCompletedAt);
    byId('checklist-feedback').textContent=`${task[1]}: ${checked?'đã đánh dấu':'đã bỏ đánh dấu'}.`;
   }else{
   const write=()=>{
    // Recheck after acquiring the lock, in case another tab completed this item.
    if(currentViewer!==actor || selectedDate!==day || today()!==day)return;
    const existing=getCompletion(owner,id);
    if(owner==='shared' && existing && (checked || existing.completedBy!==actor || existing.completedAt!==expectedCompletedAt)){
     byId('checklist-feedback').textContent=`${task[1]} đã được cập nhật. Chỉ người hoàn thành mới được bỏ đánh dấu.`;
     return;
    }
    if(checked && !existing) localStorage.setItem(key,JSON.stringify({completedAt:new Date().toISOString(),completedBy:actor,...(note?{note}:{})}));
    else if(!checked && (owner!=='shared' || existing?.completedBy===actor)) localStorage.removeItem(key);
    byId('checklist-feedback').textContent=`${task[1]}: ${checked?(note?'đã lưu hoàn thành, không có bài tập':'đã lưu hoàn thành'):'đã bỏ đánh dấu'}.`;
   };
   if(navigator.locks)await navigator.locks.request(key,write);
   else write();
   }
  } catch (error) {
   byId('checklist-error').textContent=error.message || 'Chưa lưu được thay đổi. Hãy kiểm tra quyền lưu dữ liệu hoặc dung lượng trình duyệt rồi thử lại.';
  }
  renderChecklist();
  if(currentViewer===actor && selectedDate===day){
   const control=byId(`task-${owner}-${id}`);
   if(control && !control.disabled)control.focus({preventScroll:true});
   else if(control){const row=control.closest('li');row.tabIndex=-1;row.focus({preventScroll:true});}
  }
 }
 byId('checklist').addEventListener('change',event=>{
  if(event.target.matches('input[data-task]'))saveTask(event.target,event.target.checked);
 });
 byId('checklist').addEventListener('click',event=>{
  const button=event.target.closest('button[data-no-homework]');
  if(button && !button.disabled)saveTask(button,true,'không có');
 });
 byId('checklist-date').addEventListener('change',event=>{
  const value=event.target.value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))){event.target.value=selectedDate;return;}
  selectedDate=value;renderChecklist();
 });
 document.querySelectorAll('[data-date-step]').forEach(button=>button.addEventListener('click',()=>{
  const day=new Date(selectedDate+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+Number(button.dataset.dateStep));
  selectedDate=day.toISOString().slice(0,10);renderChecklist();
 }));
 byId('checklist-today').addEventListener('click',()=>{selectedDate=today();renderChecklist();});
 document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
 window.addEventListener('storage',event=>{if(event.key===null || event.key.startsWith(prefix))renderChecklist();});
 window.addEventListener('focus',rollDate);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)rollDate();});
 setInterval(rollDate,30000);
 window.renderChecklist=renderChecklist;
 window.setAppView=setView;
 window.TKBCloud?.subscribe(renderChecklist);
 window.addEventListener('tkb-conflict',event=>{byId('checklist-error').textContent=event.detail;});
 try {
  for(const key of Object.keys(localStorage)){
   const match=key.match(/^tkb-checklist:v1:(\d{4}-\d{2}-\d{2}):shared:(bath|uniform)$/);
   if(!match)continue;
   const raw=localStorage.getItem(key),record=JSON.parse(raw);
   if(!record || !Object.hasOwn(students,record.completedBy) || !Number.isFinite(Date.parse(record.completedAt)))continue;
   const archive=`tkb-checklist:legacy-${match[2]}:v1:${match[1]}`;
   if(!localStorage.getItem(archive)){
    const personal=`${prefix}${match[1]}:${record.completedBy}:${match[2]}`;
    if(!localStorage.getItem(personal))localStorage.setItem(personal,raw);
    localStorage.setItem(archive,raw);
   }
   localStorage.removeItem(key);
  }
 } catch (_) {
  byId('checklist-error').textContent='Chưa chuyển được một số lịch sử việc riêng. Dữ liệu cũ vẫn được giữ; hãy kiểm tra quyền lưu dữ liệu rồi tải lại.';
 }
 setView(selectedView);
})();
