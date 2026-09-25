(() => {
 'use strict';
 const dialog=document.createElement('dialog');dialog.id='task-editor';dialog.setAttribute('aria-labelledby','task-editor-title');
 dialog.innerHTML=`<div class="catalog-heading"><h2 id="task-editor-title">Quản lý công việc</h2><button type="button" id="catalog-close">Đóng</button></div><label for="catalog-scope">Áp dụng</label><select id="catalog-scope"><option value="day">Chỉ ngày đang xem</option><option value="future">Từ hôm nay về sau</option></select><p id="catalog-scope-note"></p><label for="task-owner">Nhóm công việc</label><select id="task-owner"><option value="shared">Việc chung</option><option value="khoi">Việc riêng · Khôi</option><option value="nhan">Việc riêng · Nhân</option></select><form id="catalog-form"><label for="catalog-name">Tên công việc</label><input id="catalog-name" maxlength="160" required><div class="catalog-actions"><button type="submit" id="catalog-save">Thêm công việc</button><button type="button" id="catalog-reset" hidden>Hủy sửa</button></div></form><p id="catalog-status" role="status"></p><p id="catalog-sort-help">Kéo tay nắm để đổi thứ tự, hoặc dùng nút lên/xuống.</p><ul id="catalog-list"></ul>`;
 document.body.append(dialog);
 const $=id=>document.getElementById(id);let editing=null,busy=false,selectedDay=null,drag=null;
 let renderedTasks=[],renderedRevision=0;
 const daily=()=>$('catalog-scope').value==='day';
 const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function reset(){editing=null;$('catalog-name').value='';$('catalog-save').textContent='Thêm công việc';$('catalog-reset').hidden=true;}
 function render(){
  if(drag)return;
  const dateLabel=selectedDay.split('-').reverse().join('/');
  $('catalog-scope-note').textContent=daily()?`Chỉ áp dụng ngày ${dateLabel}. Các ngày khác giữ nguyên.`:'Áp dụng từ hôm nay về sau. Các chỉnh sửa riêng từng ngày vẫn được ưu tiên.';
  const weekend=daily()&&[0,6].includes(new Date(selectedDay+'T12:00:00Z').getUTCDay());
  $('catalog-form').hidden=weekend;
  const list=$('catalog-list');list.replaceChildren();
  if(weekend){list.textContent='Thứ Bảy và Chủ nhật nghỉ, không có danh sách công việc.';return;}
  const tasks=window.TKBCloud.catalogForDay($('task-owner').value,daily()?selectedDay:day(),daily());
  renderedTasks=tasks;renderedRevision=window.TKBCloud.orderRevision($('task-owner').value,daily()?'day':'future',daily()?selectedDay:day());
  for(const task of tasks){
   const row=document.createElement('li'),name=document.createElement('span');name.textContent=task.name;row.dataset.taskId=task.task_id;name.className='catalog-task-name';row.append(name);
   const actions=document.createElement('div');actions.className='catalog-row-actions';
   for(const [label,action] of [['Sửa',()=>{editing=task;$('catalog-name').value=task.name;$('catalog-save').textContent='Lưu thay đổi';$('catalog-reset').hidden=false;$('catalog-name').focus();}],['Xóa',()=>{if(confirm(`Xóa “${task.name}” ${daily()?`chỉ trong ngày ${dateLabel}`:'khỏi danh sách từ hôm nay'}?`))void save(task,true);} ]]){
    const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',`${label} ${task.name}`);button.disabled=busy;button.dataset.action=label==='Sửa'?'edit':'delete';button.onclick=action;actions.append(button);
   }
   for(const [label,delta,path] of [['Lên',-1,'m6 14 6-6 6 6'],['Xuống',1,'m6 10 6 6 6-6']]){
    const button=document.createElement('button');button.type='button';button.dataset.move=String(delta);button.setAttribute('aria-label',`${task.name}: chuyển ${label.toLowerCase()}`);button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;button.disabled=busy||(delta<0?tasks[0]===task:tasks.at(-1)===task);button.onclick=()=>moveTask(task.task_id,delta);actions.append(button);
   }
   const handle=document.createElement('button');handle.type='button';handle.className='catalog-drag';handle.disabled=busy;handle.setAttribute('aria-label',`Kéo để đổi thứ tự ${task.name}`);handle.setAttribute('aria-describedby','catalog-sort-help');handle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h1m6 0h1M8 12h1m6 0h1M8 19h1m6 0h1"/></svg>';handle.onpointerdown=event=>startDrag(event,row,handle);handle.onkeydown=event=>{if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();moveTask(task.task_id,event.key==='ArrowUp'?-1:1);}};
   row.prepend(handle);row.append(actions);list.append(row);
  }
  if(!list.children.length)list.textContent='Chưa có công việc trong nhóm này.';
 }
 async function persistOrder(ids,focusId){
  if(busy)return;
  if(ids.every((id,i)=>id===renderedTasks[i]?.task_id)){render();return;}
  busy=true;dialog.setAttribute('aria-busy','true');dialog.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);$('catalog-status').textContent='Đang lưu thứ tự…';
  try{await window.TKBCloud.reorderCatalog($('task-owner').value,daily()?'day':'future',daily()?selectedDay:day(),ids,renderedRevision);$('catalog-status').textContent='Đã lưu thứ tự công việc.';}
  catch(error){$('catalog-status').textContent=error.message;}
  finally{busy=false;dialog.removeAttribute('aria-busy');dialog.querySelectorAll('button,input,select').forEach(x=>x.disabled=false);render();[...$('catalog-list').children].find(row=>row.dataset.taskId===focusId)?.querySelector('.catalog-drag').focus({preventScroll:true});}
 }
 function moveTask(id,delta){
  if(busy||drag)return;
  const ids=renderedTasks.map(t=>t.task_id),i=ids.indexOf(id),next=i+delta;
  if(i<0||next<0||next>=ids.length)return;
  [ids[i],ids[next]]=[ids[next],ids[i]];void persistOrder(ids,id);
 }
 function startDrag(event,row,handle){
  if(busy||event.button!==0)return;
  event.preventDefault();handle.focus({preventScroll:true});const capture=$('catalog-list');capture.setPointerCapture(event.pointerId);
  drag={row,handle,id:event.pointerId,y:event.clientY,startY:event.clientY,moved:false};
  row.classList.add('is-dragging');
  const reposition=()=>{
   if(!drag)return;
   const rect=dialog.getBoundingClientRect();
   if(drag.y<rect.top+64)dialog.scrollTop-=12;
   else if(drag.y>rect.bottom-64)dialog.scrollTop+=12;
   const siblings=[...$('catalog-list').children].filter(x=>x!==row);
   const before=siblings.find(x=>drag.y<x.getBoundingClientRect().top+x.getBoundingClientRect().height/2);
   if(before)before.before(row);else $('catalog-list').append(row);
  };
  const timer=setInterval(()=>{if(drag?.moved)reposition();},40);
  const move=event=>{if(!drag||event.pointerId!==drag.id)return;drag.y=event.clientY;if(Math.abs(drag.y-drag.startY)>5)drag.moved=true;if(drag.moved)reposition();};
  const finish=event=>{
   if(!drag)return;const moved=drag.moved;drag=null;clearInterval(timer);row.classList.remove('is-dragging');
   capture.removeEventListener('pointermove',move);capture.removeEventListener('pointerup',finish);capture.removeEventListener('pointercancel',finish);capture.removeEventListener('lostpointercapture',finish);document.removeEventListener('keydown',escape);
   if(capture.hasPointerCapture(event.pointerId))capture.releasePointerCapture(event.pointerId);
   if(event.type==='pointerup'&&moved)void persistOrder([...$('catalog-list').children].map(x=>x.dataset.taskId),row.dataset.taskId);else render();
  };
  const escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish({type:'cancel',pointerId:drag.id});}};
  capture.addEventListener('pointermove',move);capture.addEventListener('pointerup',finish);capture.addEventListener('pointercancel',finish);capture.addEventListener('lostpointercapture',finish);document.addEventListener('keydown',escape);
 }
 // Custom listboxes avoid platform-dependent native select popups.
 for(const id of ['catalog-scope','task-owner']){
  const select=$(id),wrapper=document.createElement('div');wrapper.className='catalog-select';select.before(wrapper);wrapper.append(select);select.hidden=true;
  const trigger=document.createElement('button');trigger.type='button';trigger.id=id+'-trigger';trigger.className='catalog-select-trigger';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id+'-options');
  document.querySelector(`label[for="${id}"]`).htmlFor=trigger.id;
  const menu=document.createElement('div');menu.id=id+'-options';menu.className='catalog-select-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',id==='catalog-scope'?'Áp dụng':'Nhóm công việc');menu.hidden=true;
  wrapper.append(trigger,menu);
  const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
  const update=()=>{trigger.replaceChildren(document.createTextNode(select.selectedOptions[0].textContent));const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');arrow.setAttribute('viewBox','0 0 24 24');arrow.setAttribute('aria-hidden','true');arrow.innerHTML='<path d="m6 9 6 6 6-6"/>';trigger.append(arrow);[...menu.children].forEach((button,i)=>button.setAttribute('aria-selected',String(i===select.selectedIndex)));};
  [...select.options].forEach((option,i)=>{const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.tabIndex=-1;button.textContent=option.textContent;button.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('change'));close();trigger.focus();};menu.append(button);});
  const open=()=>{if(busy)return;document.querySelectorAll('.catalog-select-menu').forEach(x=>{x.hidden=true;});document.querySelectorAll('.catalog-select-trigger').forEach(x=>x.setAttribute('aria-expanded','false'));menu.hidden=false;trigger.setAttribute('aria-expanded','true');menu.children[select.selectedIndex].focus({preventScroll:true});};
  trigger.onclick=()=>menu.hidden?open():close();
  wrapper.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();close();trigger.focus();return;}
   if(event.key==='Tab'){close();return;}
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();if(menu.hidden){open();return;}const buttons=[...menu.children],index=buttons.indexOf(document.activeElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length].focus();}
  });
  document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target))close();});
  dialog.addEventListener('close',close);select.addEventListener('change',update);update();
 }
 async function save(task,remove=false){
  if(busy)return;busy=true;dialog.setAttribute('aria-busy','true');dialog.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);$('catalog-status').textContent='Đang lưu…';
  try{await window.TKBCloud.saveCatalog(task.owner,task.task_id,remove?task.name:$('catalog-name').value,remove,daily()?(task.dailyRevision||0):task.revision,daily()?selectedDay:null);reset();$('catalog-status').textContent=remove?'Đã xóa công việc.':'Đã lưu công việc.';}
  catch(error){$('catalog-status').textContent=error.message;}
  finally{busy=false;dialog.removeAttribute('aria-busy');dialog.querySelectorAll('button,input,select').forEach(x=>x.disabled=false);render();}
 }
 $('catalog-form').onsubmit=event=>{event.preventDefault();if(!$('catalog-name').value.trim()){$('catalog-status').textContent='Nhập tên công việc.';return;}void save(editing||{owner:$('task-owner').value,task_id:crypto.randomUUID(),revision:0});};
 $('catalog-scope').onchange=()=>{reset();$('catalog-status').textContent='';render();};
 $('task-owner').onchange=()=>{reset();render();};$('catalog-reset').onclick=reset;
 $('catalog-close').onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 $('manage-tasks').onclick=()=>{if(window.TKBCloud.role!=='parents')return;selectedDay=$('checklist-date').value||day();$('catalog-scope').value='day';$('catalog-scope').dispatchEvent(new Event('change'));reset();$('catalog-status').textContent='';render();dialog.showModal();};
 window.TKBCloud.subscribe(()=>{if(dialog.open){if(window.TKBCloud.role!=='parents')dialog.close();else render();}});
})();
