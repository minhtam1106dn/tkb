(() => {
 'use strict';
 const dialog=document.createElement('dialog');dialog.id='task-editor';dialog.setAttribute('aria-labelledby','task-editor-title');
 dialog.innerHTML=`<div class="catalog-heading"><h2 id="task-editor-title">Quản lý công việc</h2><button type="button" id="catalog-close">Đóng</button></div><p>Thay đổi áp dụng từ hôm nay. Xóa việc vẫn giữ lịch sử các ngày trước.</p><label for="task-owner">Nhóm công việc</label><select id="task-owner"><option value="shared">Việc chung</option><option value="khoi">Việc riêng · Khôi</option><option value="nhan">Việc riêng · Nhân</option></select><form id="catalog-form"><label for="catalog-name">Tên công việc</label><input id="catalog-name" maxlength="160" required><div class="catalog-actions"><button type="submit" id="catalog-save">Thêm công việc</button><button type="button" id="catalog-reset" hidden>Hủy sửa</button></div></form><p id="catalog-status" role="status"></p><ul id="catalog-list"></ul>`;
 document.body.append(dialog);
 const $=id=>document.getElementById(id);let editing=null,busy=false;
 const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function reset(){editing=null;$('catalog-name').value='';$('catalog-save').textContent='Thêm công việc';$('catalog-reset').hidden=true;}
 function render(){
  const list=$('catalog-list');list.replaceChildren();
  for(const task of window.TKBCloud.getCatalog().filter(t=>t.owner===$('task-owner').value&&(!t.retired_on||t.retired_on>day()))){
   const row=document.createElement('li'),name=document.createElement('span');name.textContent=task.name;row.append(name);
   for(const [label,action] of [['Sửa',()=>{editing=task;$('catalog-name').value=task.name;$('catalog-save').textContent='Lưu thay đổi';$('catalog-reset').hidden=false;$('catalog-name').focus();}],['Xóa',()=>{if(confirm(`Xóa “${task.name}” khỏi danh sách từ hôm nay? Lịch sử các ngày trước vẫn được giữ.`))void save(task,true);} ]]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',`${label} ${task.name}`);button.disabled=busy;button.onclick=action;row.append(button);
   }list.append(row);
  }
  if(!list.children.length)list.textContent='Chưa có công việc trong nhóm này.';
 }
 async function save(task,remove=false){
  if(busy)return;busy=true;dialog.setAttribute('aria-busy','true');dialog.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);$('catalog-status').textContent='Đang lưu…';
  try{await window.TKBCloud.saveCatalog(task.owner,task.task_id,remove?task.name:$('catalog-name').value,remove,task.revision);reset();$('catalog-status').textContent=remove?'Đã xóa công việc.':'Đã lưu công việc.';}
  catch(error){$('catalog-status').textContent=error.message;}
  finally{busy=false;dialog.removeAttribute('aria-busy');dialog.querySelectorAll('button,input,select').forEach(x=>x.disabled=false);render();}
 }
 $('catalog-form').onsubmit=event=>{event.preventDefault();if(!$('catalog-name').value.trim()){$('catalog-status').textContent='Nhập tên công việc.';return;}void save(editing||{owner:$('task-owner').value,task_id:crypto.randomUUID(),revision:0});};
 $('task-owner').onchange=()=>{reset();render();};$('catalog-reset').onclick=reset;
 $('catalog-close').onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 $('manage-tasks').onclick=()=>{if(window.TKBCloud.role!=='parents')return;reset();$('catalog-status').textContent='';render();dialog.showModal();};
 window.TKBCloud.subscribe(()=>{if(dialog.open){if(window.TKBCloud.role!=='parents')dialog.close();else render();}});
})();
