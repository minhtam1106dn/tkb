(() => {
 'use strict';
 const commonTasks = [
  ['kitchen','Quét và lau khu bếp'], ['garage','Quét và lau nhà để xe'],
  ['floor-2','Quét nhà tầng 2'], ['leaves','Lượm lá trước sân'],
  ['trash','Vứt rác'], ['plants','Tưới cây'], ['table','Lau bàn'],
  ['uniform','Giặt đồ đi học'], ['laundry','Phơi đồ trên tầng 3'],
  ['bath','Tắm rửa'], ['stairs','Lượm rác cầu thang'], ['fish','Cho cá ăn']
 ];
 const privateTasks = [
  ['school-homework','Làm bài tập trên trường'], ['extra-homework','Làm bài tập học thêm'],
  ['sm-homework','Làm bài tập ở SM'], ['prepare','Soạn thời khóa biểu']
 ];
 function taskGroups() { return [['common-tasks','shared',commonTasks],['private-tasks',selectedStudent,privateTasks]]; }
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
 let selectedView = 'schedule';
 const byId = id => document.getElementById(id);
 const keyFor = (owner,id) => `${prefix}${selectedDate}:${owner}:${id}`;
 function getCompletion(owner,id) {
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
  selectedView = view;
  byId('schedule').hidden = view !== 'schedule';
  byId('checklist').hidden = view !== 'checklist';
  document.querySelector('.skip').href = view === 'checklist' ? '#checklist' : '#schedule';
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.view===view)));
  try { localStorage.setItem('tkb-view',view); } catch (_) {}
  if (view==='checklist') renderChecklist();
 }
 function renderChecklist() {
  const student = students[selectedStudent];
  const editable = selectedDate===today() && currentViewer===selectedStudent;
  byId('checklist-date').value = selectedDate;
  byId('checklist-person').textContent = student.name;
  byId('private-title').textContent = `Việc riêng · ${student.name.replace('Nguyễn ','')}`;
  byId('checklist-date-note').textContent = currentViewer==='parents' ? 'Ba Mẹ đang xem tiến độ. Chọn Thanh Khôi hoặc Thanh Nhân ở phía trên để xem từng bạn.' : editable ? 'Hôm nay · Việc chung đã xong được khóa. Việc riêng có thể bỏ dấu tích nếu chọn nhầm.' : 'Lịch sử theo ngày · Chỉ đánh dấu và sửa việc trong ngày hôm nay.';
  let completed=0, storageFailed=false;
  for (const [listId,owner,tasks] of taskGroups()) {
   const list = byId(listId);
   list.replaceChildren();
   for (const [id,name] of tasks) {
    let record=null, readFailed=false;
    try { record=getCompletion(owner,id); } catch (_) {storageFailed=true;readFailed=true;}
    if (record) completed++;
    const locked=owner==='shared' && !!record;
    const row=document.createElement('li');
    row.className=`task-row ${record?'done':'pending'} ${editable&&!locked?'':'readonly'}`;
    const label=document.createElement('label');label.className='task-label';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=!!record;
    checkbox.disabled=!editable || readFailed || locked;
    checkbox.dataset.owner=owner;checkbox.dataset.task=id;checkbox.id=`task-${owner}-${id}`;
    const copy=document.createElement('span');copy.className='task-copy';
    const title=document.createElement('span');title.className='task-name';title.textContent=name;
    const status=document.createElement('span');status.className='task-status';status.id=`status-${owner}-${id}`;
    checkbox.setAttribute('aria-describedby',status.id);
    if (record) {
     const time=document.createElement('time');time.dateTime=record.completedAt;time.textContent=timeFormat.format(new Date(record.completedAt));
     status.append('Đã xong · ',time,` · ${students[record.completedBy].name.replace('Nguyễn ','')}${locked?' · Đã khóa':''}`);
    } else status.textContent=readFailed?'Không đọc được trạng thái đã lưu':(selectedDate>today()?'Chưa đến ngày thực hiện':'Chưa xong');
    copy.append(title,status);label.append(checkbox,copy);row.append(label);list.append(row);
   }
  }
  byId('checklist-progress').classList.toggle('complete',completed===16);
  byId('checklist-count').textContent=`${completed}/16 việc đã xong`;
  byId('checklist-remaining').textContent=completed===16?'Đã hoàn thành tất cả!':`Còn ${16-completed} việc chưa xong`;
  if (storageFailed) {
   byId('checklist-error').textContent='Không đọc được một số dữ liệu trên trình duyệt. Hãy cho phép lưu dữ liệu rồi tải lại; các mục lỗi chưa được thay đổi.';
   byId('checklist-count').textContent='Chưa đọc đủ dữ liệu';
   byId('checklist-remaining').textContent='Không thể xác định đầy đủ số việc còn lại.';
  }
 }
 function rollDate() {
  const next=today();
  if (next===lastToday) return false;
  if(selectedDate===lastToday) selectedDate=next;
  lastToday=next;renderChecklist();return true;
 }
 byId('checklist').addEventListener('change',async event=>{
  const input=event.target;
  if(!input.matches('input[data-task]'))return;
  if(rollDate() || selectedDate!==today() || currentViewer!==selectedStudent){renderChecklist();return;}
  const owner=input.dataset.owner,id=input.dataset.task;
  const group=taskGroups().find(([,candidate])=>candidate===owner);
  const task=group?.[2].find(([candidate])=>candidate===id);
  if(!task){renderChecklist();return;}
  const actor=currentViewer,day=selectedDate,checked=input.checked;
  const key=keyFor(owner,id);
  input.disabled=true;
  byId('checklist-error').textContent='';
  try {
   const write=()=>{
    // Recheck after acquiring the lock, in case another tab completed this item.
    if(currentViewer!==actor || selectedDate!==day || today()!==day)return;
    const existing=getCompletion(owner,id);
    if(owner==='shared' && existing){
     byId('checklist-feedback').textContent=`${task[1]} đã hoàn thành, không thể đánh dấu lại.`;
     return;
    }
    if(checked && !existing) localStorage.setItem(key,JSON.stringify({completedAt:new Date().toISOString(),completedBy:actor}));
    else if(!checked && owner!=='shared') localStorage.removeItem(key);
    byId('checklist-feedback').textContent=`${task[1]}: ${checked?'đã lưu hoàn thành':'đã bỏ đánh dấu'}.`;
   };
   if(navigator.locks)await navigator.locks.request(key,write);
   else write();
  } catch (_) {
   byId('checklist-error').textContent='Chưa lưu được thay đổi. Hãy kiểm tra quyền lưu dữ liệu hoặc dung lượng trình duyệt rồi thử lại.';
  }
  renderChecklist();
  if(currentViewer===actor && selectedDate===day){
   const control=byId(`task-${owner}-${id}`);
   if(control && !control.disabled)control.focus({preventScroll:true});
   else if(control){const row=control.closest('li');row.tabIndex=-1;row.focus({preventScroll:true});}
  }
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
 try{if(localStorage.getItem('tkb-view')==='checklist')selectedView='checklist';}catch(_){}
 setView(selectedView);
})();
