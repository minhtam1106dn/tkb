(() => {
 'use strict';
 const zone='Asia/Ho_Chi_Minh';
 const byId=id=>document.getElementById(id);
 const dateKeyFormat=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
 const fullDateFormat=new Intl.DateTimeFormat('vi-VN',{timeZone:zone,weekday:'long',day:'numeric',month:'numeric',year:'numeric'});
 const shortDateFormat=new Intl.DateTimeFormat('vi-VN',{timeZone:zone,day:'numeric',month:'numeric'});
 const monthFormat=new Intl.DateTimeFormat('vi-VN',{timeZone:zone,month:'long',year:'numeric'});
 const weekdayFormat=new Intl.DateTimeFormat('vi-VN',{timeZone:zone,weekday:'short'});
 let rangeMode='day',anchor=today(),lastToday=anchor,loadingKey='',loadedAt=new Map(),requestVersion=0;

 function today(){
  const parts=Object.fromEntries(dateKeyFormat.formatToParts(new Date()).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
 }
 const parse=value=>new Date(value+'T12:00:00Z');
 const key=date=>date.toISOString().slice(0,10);
 function move(value,days){const date=parse(value);date.setUTCDate(date.getUTCDate()+days);return key(date);}
 function dates(from,to){const result=[];for(let value=from;value<=to;value=move(value,1)){const day=parse(value).getUTCDay();if(day!==0&&day!==6)result.push(value);}return result;}
 function range(){
  const date=parse(anchor);
  if(rangeMode==='day')return {from:anchor,to:anchor,periodEnd:anchor};
  if(rangeMode==='week'){
   const offset=(date.getUTCDay()+6)%7;
   const from=move(anchor,-offset),periodEnd=move(anchor,6-offset);
   return {from,to:periodEnd>today()?today():periodEnd,periodEnd};
  }
  const year=date.getUTCFullYear(),month=date.getUTCMonth();
  const from=key(new Date(Date.UTC(year,month,1,12))),periodEnd=key(new Date(Date.UTC(year,month+1,0,12)));
  return {from,to:periodEnd>today()?today():periodEnd,periodEnd};
 }
 function rangeLabel({from,periodEnd}){
  if(rangeMode==='day')return `${from===today()?'Hôm nay · ':''}${fullDateFormat.format(parse(from))}`;
  if(rangeMode==='month')return monthFormat.format(parse(from));
  return `Tuần ${shortDateFormat.format(parse(from))} – ${shortDateFormat.format(parse(periodEnd))}`;
 }
 function catalog(role,day){
  const common=window.TKB_TASKS.forDay('shared',day).map(([id,name])=>({owner:'shared',id,name,group:'Việc chung'}));
  const owners=role==='parents'?['khoi','nhan']:[role];
  return common.concat(owners.flatMap(owner=>window.TKB_TASKS.forDay(owner,day).map(([id,name])=>({owner,id,name,group:`Việc riêng ${owner==='khoi'?'Khôi':'Nhân'}`}))));
 }
 function analyze(rows,period,role){
  const allDates=dates(period.from,period.to);
  const rowMap=new Map(rows.map(row=>[`${row.day}:${row.owner}:${row.task_id}`,row]));
  const missed=new Map(),breakdown=new Map(),dayStats=[];
  let done=0,noHomework=0,perfectDays=0;
  for(const day of allDates){
   const tasks=catalog(role,day);
   let dayDone=0;
   for(const task of tasks){
    const row=rowMap.get(`${day}:${task.owner}:${task.id}`),complete=!!row?.completed;
    const group=breakdown.get(task.group)||{done:0,total:0};group.total++;
    if(complete){done++;dayDone++;group.done++;if(row.note==='không có')noHomework++;}
    else missed.set(`${task.owner}:${task.id}`,{task,count:(missed.get(`${task.owner}:${task.id}`)?.count||0)+1});
    breakdown.set(task.group,group);
   }
   const total=tasks.length,pct=total?Math.round(dayDone/total*100):0;
   if(total && dayDone===total)perfectDays++;
   dayStats.push({day,done:dayDone,total,pct});
  }
  let streak=0,index=dayStats.length-1;
  if(dayStats[index]?.day===today()&&dayStats[index].done<dayStats[index].total)index--;
  for(;index>=0&&dayStats[index].total>0&&dayStats[index].done===dayStats[index].total;index--)streak++;
  const expected=new Set(allDates.flatMap(day=>catalog(role,day).map(task=>`${day}:${task.owner}:${task.id}`)));
  const completedRows=rows.filter(row=>row.completed&&expected.has(`${row.day}:${row.owner}:${row.task_id}`));
  const contribution={khoi:0,nhan:0};
  for(const row of completedRows)if(row.owner==='shared'&&Object.hasOwn(contribution,row.completed_by))contribution[row.completed_by]++;
  const total=dayStats.reduce((sum,day)=>sum+day.total,0),pct=total?Math.round(done/total*100):0;
  const attention=[...missed.values()].sort((a,b)=>b.count-a.count||a.task.name.localeCompare(b.task.name,'vi')).slice(0,4);
  const best=dayStats.reduce((winner,item)=>!winner||item.pct>winner.pct?item:winner,null);
  return {allDates,done,total,pct,noHomework,perfectDays,streak,breakdown,dayStats,contribution,attention,best};
 }
 function buckets(stats){
  if(rangeMode!=='month')return stats.map(item=>({label:rangeMode==='day'?'Ngày này':weekdayFormat.format(parse(item.day)),done:item.done,total:item.total,pct:item.pct}));
  const result=[];
  for(let i=0;i<stats.length;i+=7){
   const group=stats.slice(i,i+7),done=group.reduce((sum,item)=>sum+item.done,0),total=group.reduce((sum,item)=>sum+item.total,0);
   result.push({label:`${parse(group[0].day).getUTCDate()}–${parse(group.at(-1).day).getUTCDate()}`,done,total,pct:total?Math.round(done/total*100):0});
  }
  return result;
 }
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const meter=(label,done,total)=>`<div class="dashboard-meter"><div><span>${label}</span><strong>${done}/${total}</strong></div><div class="meter-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${total?done/total*100:0}%"></span></div></div>`;
 function insight(data,role){
  if(!data.total)return {title:'Chưa có công việc',text:'Không có công việc cần thực hiện trong kỳ này.'};
  if(data.done===data.total)return {title:'Hoàn thành rất tốt',text:`Đã hoàn thành toàn bộ ${data.total} việc trong kỳ này.`};
  if(!data.attention.length)return {title:'Chưa có dữ liệu',text:'Hãy hoàn thành checklist để bắt đầu theo dõi tiến độ.'};
  const first=data.attention[0].task;
  if(role==='parents'){
   const entries=[...data.breakdown].filter(([label])=>label.startsWith('Việc riêng')).map(([label,value])=>({label,...value,pct:value.total?value.done/value.total:0})).sort((a,b)=>a.pct-b.pct);
   if(entries[0])return {title:'Gợi ý theo dõi',text:`${entries[0].label} còn ${entries[0].total-entries[0].done} mục. Có thể ưu tiên “${first.name}”.`};
  }
  return {title:'Việc nên làm tiếp',text:`Ưu tiên “${first.name}”; mục này còn thiếu ${data.attention[0].count} ngày trong kỳ.`};
 }
 function paint(rows,period,role){
  const data=analyze(rows,period,role),tip=insight(data,role),chart=buckets(data.dayStats);
  const breakdown=[...data.breakdown].map(([label,value])=>meter(label,value.done,value.total)).join('');
  const sharedTotal=data.contribution.khoi+data.contribution.nhan;
  const khoiShare=sharedTotal?Math.round(data.contribution.khoi/sharedTotal*100):0,nhanShare=sharedTotal?100-khoiShare:0;
  const contribution=sharedTotal?`<div class="contribution-layout"><div class="contribution-donut" style="--khoi-share:${khoiShare*3.6}deg" role="img" aria-label="Thanh Khôi ${data.contribution.khoi} việc, ${khoiShare} phần trăm; Thanh Nhân ${data.contribution.nhan} việc, ${nhanShare} phần trăm"><span><strong>${sharedTotal}</strong><small>việc chung</small></span></div><div class="contribution-legend"><div><i class="contribution-dot khoi" aria-hidden="true"></i><span>Thanh Khôi</span><strong>${data.contribution.khoi} · ${khoiShare}%</strong></div><div><i class="contribution-dot nhan" aria-hidden="true"></i><span>Thanh Nhân</span><strong>${data.contribution.nhan} · ${nhanShare}%</strong></div></div></div>`:'<p class="dashboard-empty">Chưa có việc chung hoàn thành trong kỳ.</p>';
  const attention=data.attention.length?`<ol class="attention-list">${data.attention.map(({task,count})=>`<li><span>${role==='parents'&&task.owner!=='shared'?`${escape(task.name)} · ${task.owner==='khoi'?'Khôi':'Nhân'}`:escape(task.name)}</span><strong>${count} ngày</strong></li>`).join('')}</ol>`:'<p class="dashboard-empty">Không có việc bị bỏ sót.</p>';
  byId('dashboard-content').innerHTML=`
   <div class="dashboard-summary">
    <article class="summary-card progress-card"><div class="progress-ring" style="--progress:${data.pct*3.6}deg" role="progressbar" aria-label="Tiến độ hoàn thành" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${data.pct}"><span>${data.pct}%</span></div><div><h3>Tiến độ</h3><p>${data.done}/${data.total} việc đã xong</p></div></article>
    <article class="summary-card"><span class="summary-label">Ngày hoàn thành đủ</span><strong>${data.perfectDays}/${data.allDates.length}</strong><small>ngày trong kỳ</small></article>
    <article class="summary-card"><span class="summary-label">Chuỗi hoàn thành</span><strong>${data.streak}</strong><small>ngày liên tiếp trong kỳ</small></article>
    <article class="summary-card"><span class="summary-label">Không có bài</span><strong>${data.noHomework}</strong><small>lần đã xác nhận</small></article>
   </div>
   <article class="dashboard-insight"><div class="insight-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M8.5 14.5A7 7 0 1 1 15.5 14.5C14.5 15.3 14 16.1 14 18h-4c0-1.9-.5-2.7-1.5-3.5Z"/></svg></div><div><h3>${tip.title}</h3><p>${escape(tip.text)}</p></div></article>
   <div class="dashboard-details">
    <article class="dashboard-card trend-card"><header><div><h3>Nhịp hoàn thành</h3><p>${data.best?`Tốt nhất: ${shortDateFormat.format(parse(data.best.day))} · ${data.best.pct}%`:'Chưa có dữ liệu'}</p></div></header><div class="trend-chart">${chart.map(item=>`<div class="trend-column" title="${item.label}: ${item.done}/${item.total} việc"><strong>${item.pct}%</strong><div class="trend-track"><span style="height:${Math.max(item.pct,item.pct?8:0)}%"></span></div><small>${item.label}</small></div>`).join('')}</div></article>
    <article class="dashboard-card"><h3>Chi tiết tiến độ</h3><div class="dashboard-meters">${breakdown}</div></article>
    <article class="dashboard-card"><h3>Việc cần chú ý</h3>${attention}</article>
    <article class="dashboard-card contribution-card"><h3>Ai làm việc chung</h3>${contribution}</article>
   </div>`;
 }
 function draw(){
  if(!currentViewer||byId('dashboard').hidden)return;
  const period=range(),role=currentViewer;
  byId('dashboard-period-label').textContent=rangeLabel(period);
  document.querySelectorAll('[data-dashboard-range]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.dashboardRange===rangeMode)));
  document.querySelector('[data-dashboard-step="1"]').disabled=period.periodEnd>=today();
  const rows=window.TKBCloud?.getRows(period.from,period.to)||[];
  paint(rows,period,role);
  ensureLoaded(period,role);
 }
 function ensureLoaded(period,role,force=false){
  if(!window.TKBCloud?.loadRange)return;
  const cacheKey=`${role}:${period.from}:${period.to}`;
  if(loadingKey===cacheKey||(!force&&Date.now()-(loadedAt.get(cacheKey)||0)<30000))return;
  loadingKey=cacheKey;const version=++requestVersion;
  byId('dashboard-loading').textContent='Đang cập nhật số liệu…';byId('dashboard-error').textContent='';
  window.TKBCloud.loadRange(period.from,period.to).then(rows=>{
   if(version!==requestVersion||currentViewer!==role)return;
   loadedAt.set(cacheKey,Date.now());paint(rows,period,role);
  }).catch(error=>{if(version===requestVersion)byId('dashboard-error').textContent=error.message||'Chưa tải được số liệu tổng quan.';})
   .finally(()=>{if(version===requestVersion){loadingKey='';byId('dashboard-loading').textContent='';}});
 }
 function step(direction){
  if(rangeMode==='day')anchor=move(anchor,direction);
  else if(rangeMode==='week')anchor=move(anchor,direction*7);
  else {const date=parse(anchor);date.setUTCMonth(date.getUTCMonth()+direction,1);anchor=key(date);}
  const next=range();if(next.from>today())anchor=today();draw();
 }
 document.querySelectorAll('[data-dashboard-range]').forEach(button=>button.addEventListener('click',()=>{rangeMode=button.dataset.dashboardRange;anchor=today();draw();}));
 document.querySelectorAll('[data-dashboard-step]').forEach(button=>button.addEventListener('click',()=>step(Number(button.dataset.dashboardStep))));
 byId('dashboard-current').addEventListener('click',()=>{anchor=today();draw();});
 window.renderDashboard=draw;
 window.TKBCloud?.subscribe(draw);
 function refresh(){
  const next=today();if(anchor===lastToday)anchor=next;lastToday=next;
  if(!document.hidden&&!byId('dashboard').hidden&&currentViewer){draw();ensureLoaded(range(),currentViewer,true);}
 }
 setInterval(refresh,30000);
 window.addEventListener('focus',refresh);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 draw();
})();
