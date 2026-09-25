(() => {
 'use strict';
 const names=['Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy','Chủ nhật'];
 const dialog=document.createElement('dialog');dialog.id='schedule-editor';dialog.setAttribute('aria-labelledby','schedule-editor-title');
 dialog.innerHTML=`<div class="schedule-editor-heading"><h2 id="schedule-editor-title">Chỉnh thời khóa biểu</h2><button type="button" id="schedule-close">Đóng</button></div><p>Lịch lặp lại mỗi tuần. Chọn con và ngày cần sửa, rồi bấm Lưu.</p><div id="schedule-children" class="schedule-choices" role="group" aria-label="Chọn con"><button type="button" data-edit-child="khoi">Thanh Khôi</button><button type="button" data-edit-child="nhan">Thanh Nhân</button></div><div id="schedule-weekdays" class="schedule-choices" role="group" aria-label="Chọn ngày trong tuần"></div><form id="schedule-edit-form"><h3 id="schedule-edit-day"></h3><p id="schedule-edit-status" role="status" tabindex="-1"></p><div id="schedule-editor-groups"></div><div class="schedule-editor-actions"><button type="submit" id="schedule-save">Lưu lịch ngày này</button><button type="button" id="schedule-cancel">Hủy</button></div></form>`;
 document.body.append(dialog);
 const $=id=>document.getElementById(id);
 let child='khoi',index=0,draft=null,expected=null,baseline='',busy=false,scroll=null;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const dirty=()=>draft&&JSON.stringify(draft)!==baseline;
 function close(force=false){
  if(busy&&!force)return;
  if(!force&&dirty()&&!confirm('Bỏ những thay đổi chưa lưu trong ngày này?'))return;
  dialog.close();unlock();
 }
 function unlock(){if(!scroll)return;const saved=scroll;scroll=null;document.body.classList.remove('schedule-editor-open');document.documentElement.classList.remove('schedule-editor-open');document.body.style.removeProperty('--schedule-page-top');window.scrollTo({left:saved.x,top:saved.y,behavior:'instant'});}
 dialog.addEventListener('close',()=>{if(!dialog.open)unlock();});
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 function loadDay(){
  expected=clone(students[child].days[index]||null);
  draft={school:clone(expected?.school||[]),second:clone(expected?.second||[]),secondStart:expected?.secondStart||1,extra:clone(expected?.extra||[])};
  for(const group of ['school','second'])draft[group]=draft[group].map(item=>item?[item[0],item[1]||'']:null);
  baseline=JSON.stringify(draft);$('schedule-edit-status').textContent='';paint();
 }
 function choose(nextChild,nextIndex){if(busy)return;if(dirty()&&!confirm('Bỏ những thay đổi chưa lưu trước khi chuyển ngày hoặc chuyển con?'))return;child=nextChild;index=nextIndex;loadDay();}
 for(let i=0;i<7;i++){const button=document.createElement('button');button.type='button';button.textContent=names[i];button.dataset.editDay=i;button.onclick=()=>choose(child,i);$('schedule-weekdays').append(button);}
 dialog.querySelectorAll('[data-edit-child]').forEach(button=>button.onclick=()=>choose(button.dataset.editChild,index));
 function field(label,type,value,onInput,required=false,maxLength=100){
  const wrap=document.createElement('label');wrap.textContent=label;
  const input=document.createElement('input');input.type=type;input.value=value;input.required=required;
  if(type==='text')input.maxLength=maxLength;
  input.oninput=()=>{dialog.querySelectorAll('input').forEach(field=>field.setCustomValidity(''));onInput(input.value);};wrap.append(input);return wrap;
 }
 function paint(){
  $('schedule-edit-day').textContent=`${child==='khoi'?'Thanh Khôi':'Thanh Nhân'} · ${names[index]}`;
  dialog.querySelectorAll('[data-edit-child]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.editChild===child)));
  dialog.querySelectorAll('[data-edit-day]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.editDay)===index)));
  const groups=$('schedule-editor-groups');groups.replaceChildren();
  for(const [group,title] of [['school','Ở trường · Sáng'],['second','Ở trường · Chiều'],['extra','Học thêm']]){
   const section=document.createElement('fieldset');section.dataset.group=group;
   const legend=document.createElement('legend');legend.textContent=title;section.append(legend);
   if(group==='second'){
    const start=field('Bắt đầu từ tiết','number',draft.secondStart,value=>{draft.secondStart=Number(value);dialog.querySelectorAll('[data-group=second] .schedule-edit-row>strong').forEach((label,i)=>label.textContent=`Tiết ${draft.secondStart+i}`);});
    start.querySelector('input').min=1;start.querySelector('input').max=12;start.querySelector('input').required=true;start.className='schedule-start';section.append(start);
   }
   if(!draft[group].length){const p=document.createElement('p');p.textContent='Chưa có tiết học.';section.append(p);}
   draft[group].forEach((item,i)=>{
    const row=document.createElement('div');row.className='schedule-edit-row';row.dataset.lesson=i;
    if(group==='extra'){
     row.append(field('Bắt đầu','time',item[0],v=>draft[group][i][0]=v,true),field('Kết thúc','time',item[1],v=>draft[group][i][1]=v,true),field('Môn học / nội dung','text',item[2],v=>draft[group][i][2]=v,true,160));
    }else{
     const number=document.createElement('strong');number.textContent=`Tiết ${i+(group==='second'?draft.secondStart:1)}`;row.append(number);
     const change=(j,value)=>{draft[group][i]||=['',''];draft[group][i][j]=value;};
     row.append(field('Môn học','text',item?.[0]||'',v=>change(0,v)),field('Giáo viên (không bắt buộc)','text',item?.[1]||'',v=>change(1,v)));
    }
    const remove=document.createElement('button');remove.type='button';remove.textContent=group==='extra'?'Xóa buổi':'Xóa nội dung';remove.setAttribute('aria-label',`${remove.textContent} ${title}, mục ${i+1}`);
    remove.onclick=()=>{if(group==='extra')draft[group].splice(i,1);else{draft[group][i]=null;while(draft[group].length&&draft[group].at(-1)===null)draft[group].pop();}paint();};row.append(remove);section.append(row);
   });
   const add=document.createElement('button');add.type='button';add.textContent=group==='extra'?'Thêm buổi học thêm':'Thêm tiết';add.dataset.addLesson=group;add.disabled=draft[group].length>=12;
   add.onclick=()=>{if(draft[group].length>=12)return;draft[group].push(group==='extra'?['16:00','17:00','']:['','']);paint();$('schedule-editor-groups').querySelector(`[data-group="${group}"] .schedule-edit-row:last-of-type input`)?.focus();};section.append(add);groups.append(section);
  }
 }
 $('schedule-edit-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const clean=clone(draft),status=$('schedule-edit-status');status.textContent='';
  for(const group of ['school','second']){
   for(let i=0;i<clean[group].length;i++){
    const item=clean[group][i];if(!item)continue;
    clean[group][i]=item.map(value=>value.trim());
    if(!clean[group][i][0]){
     if(clean[group][i][1]){const input=dialog.querySelector(`[data-group="${group}"] [data-lesson="${i}"] input`);input.setCustomValidity('Nhập môn học trước khi nhập giáo viên.');input.reportValidity();return;}
     clean[group][i]=null;
    }
   }
   while(clean[group].length&&clean[group].at(-1)===null)clean[group].pop();
  }
  if(clean.secondStart+clean.second.length-1>12){status.textContent='Buổi chiều chỉ có số tiết từ 1 đến 12.';status.focus();return;}
  for(let i=0;i<clean.extra.length;i++){
   const lesson=clean.extra[i];lesson[2]=lesson[2].trim();
   const inputs=dialog.querySelectorAll(`[data-group="extra"] [data-lesson="${i}"] input`);
   if(lesson[0]>=lesson[1]){inputs[1].setCustomValidity('Giờ kết thúc phải sau giờ bắt đầu.');inputs[1].reportValidity();return;}
   if(!lesson[2]){inputs[2].setCustomValidity('Nhập môn học hoặc nội dung.');inputs[2].reportValidity();return;}
  }
  busy=true;dialog.setAttribute('aria-busy','true');dialog.querySelectorAll('button,input').forEach(x=>x.disabled=true);status.textContent='Đang lưu lịch…';
  try{const saved=await window.TKBCloud.saveTimetableDay(child,index,clean,expected);expected=clone(saved.days[index]);draft=clean;baseline=JSON.stringify(draft);paint();status.textContent='Đã lưu. Lịch trong tuần và Hôm nay đã được cập nhật.';}
  catch(error){status.textContent=error.message||'Chưa lưu được lịch. Nội dung bạn nhập vẫn được giữ.';}
  finally{busy=false;dialog.removeAttribute('aria-busy');dialog.querySelectorAll('button,input').forEach(x=>x.disabled=false);dialog.querySelectorAll('[data-add-lesson]').forEach(button=>button.disabled=draft[button.dataset.addLesson].length>=12);}
 });
 $('schedule-close').onclick=()=>close();$('schedule-cancel').onclick=()=>close();
 $('edit-timetable').onclick=()=>{
  if(window.TKBCloud.role!=='parents')return;
  child=selectedStudent;index=(currentDay+6)%7;loadDay();
  scroll={x:window.scrollX,y:window.scrollY};document.body.style.setProperty('--schedule-page-top',`${-scroll.y}px`);document.body.classList.add('schedule-editor-open');document.documentElement.classList.add('schedule-editor-open');
  try{dialog.showModal();dialog.scrollTop=0;}catch(error){unlock();throw error;}
 };
 window.TKBCloud.subscribe(()=>{if(dialog.open&&window.TKBCloud.role!=='parents')close(true);});
})();
