(() => {
 'use strict';
 const zone='Asia/Ho_Chi_Minh',byId=id=>document.getElementById(id);
 const keyFormat=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});
 const fullFormat=new Intl.DateTimeFormat('vi-VN',{timeZone:zone,weekday:'long',day:'numeric',month:'numeric',year:'numeric'});
 const shortFormat=new Intl.DateTimeFormat('vi-VN',{timeZone:zone,day:'numeric',month:'numeric'});
 const monthFormat=new Intl.DateTimeFormat('vi-VN',{timeZone:zone,month:'long',year:'numeric'});
 let mode='day',anchor=today(),lastToday=anchor,loadingKey='',requestVersion=0;
 const cached=new Map(),loadedAt=new Map();
 function today(){const parts=Object.fromEntries(keyFormat.formatToParts(new Date()).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
 const parse=value=>new Date(value+'T12:00:00Z'),key=date=>date.toISOString().slice(0,10);
 function move(value,days){const date=parse(value);date.setUTCDate(date.getUTCDate()+days);return key(date);}
 function period(){
  const date=parse(anchor);
  if(mode==='day')return {from:anchor,to:anchor,periodEnd:anchor};
  if(mode==='week'){
   const offset=(date.getUTCDay()+6)%7,from=move(anchor,-offset),periodEnd=move(anchor,6-offset);
   return {from,to:periodEnd>today()?today():periodEnd,periodEnd};
  }
  const year=date.getUTCFullYear(),month=date.getUTCMonth();
  const from=key(new Date(Date.UTC(year,month,1,12))),periodEnd=key(new Date(Date.UTC(year,month+1,0,12)));
  return {from,to:periodEnd>today()?today():periodEnd,periodEnd};
 }
 function label({from,periodEnd}){
  if(mode==='day')return `${from===today()?'Hôm nay · ':''}${fullFormat.format(parse(from))}`;
  if(mode==='month')return monthFormat.format(parse(from));
  return `Tuần ${shortFormat.format(parse(from))} – ${shortFormat.format(parse(periodEnd))}`;
 }
 const number=value=>Number(value)||0;
 const name=student=>student==='khoi'?'Thanh Khôi':'Thanh Nhân';
 function normalize(rows){
  const source=new Map((rows||[]).map(row=>[row.student,row]));
  return ['khoi','nhan'].map(student=>{
   const row=source.get(student)||{};
   return {student,privateDone:number(row.private_done),privateExpected:number(row.private_expected),sharedDone:number(row.shared_done),
    completionPoints:number(row.completion_points),sharedPoints:number(row.shared_points),earlyBonus:number(row.early_bonus),
    perfectDays:number(row.perfect_days),consistencyPoints:number(row.consistency_points),score:number(row.score)};
  }).sort((a,b)=>b.score-a.score||a.student.localeCompare(b.student));
 }
 function rankCard(row,index,tied,maxScore){
  const progress=row.privateExpected?Math.round(row.privateDone/row.privateExpected*100):0;
  return `<article class="ranking-card ${index===0&&!tied?'leader':''}">
   <header><span class="rank-number">${tied?'=':index+1}</span><div><h3>${name(row.student)}</h3><p>${tied?'Đồng hạng':index===0?'Đang dẫn đầu':'Hạng 2'}</p></div><strong class="rank-score">${row.score}<small>điểm</small></strong></header>
   <div class="score-track" role="progressbar" aria-label="Điểm của ${name(row.student)}" aria-valuemin="0" aria-valuemax="${Math.max(maxScore,1)}" aria-valuenow="${row.score}"><span style="width:${maxScore?row.score/maxScore*100:0}%"></span></div>
   <dl class="score-breakdown"><div><dt>Việc riêng</dt><dd>${row.privateDone}/${row.privateExpected}<small>+${row.completionPoints}</small></dd></div><div><dt>Việc chung</dt><dd>${row.sharedDone} mục<small>+${row.sharedPoints}</small></dd></div><div><dt>Thưởng sớm</dt><dd>${row.earlyBonus}<small>điểm</small></dd></div><div><dt>Ngày hoàn thành đủ</dt><dd>${row.perfectDays}<small>+${row.consistencyPoints}</small></dd></div></dl>
   <p class="private-rate">Tỷ lệ hoàn thành việc riêng <strong>${progress}%</strong></p>
  </article>`;
 }
 function paint(rows){
  const ranking=normalize(rows),difference=ranking[0].score-ranking[1].score,tied=difference===0,maxScore=ranking[0].score;
  const message=tied?'Hai bạn đang bằng điểm.':`${name(ranking[0].student)} đang dẫn trước ${difference} điểm.`;
  byId('leaderboard-content').innerHTML=`<div class="ranking-summary"><span>Xếp hạng hiện tại</span><strong>${message}</strong><small>Tính từ số mục hoàn thành, thời gian và mức độ đều đặn.</small></div><div class="ranking-grid">${ranking.map((row,index)=>rankCard(row,index,tied,maxScore)).join('')}</div>`;
 }
 function draw(force=false){
  if(!currentViewer||byId('leaderboard').hidden)return;
  const current=period(),cacheKey=`${current.from}:${current.to}`;
  byId('leaderboard-period-label').textContent=label(current);
  document.querySelectorAll('[data-leaderboard-range]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.leaderboardRange===mode)));
  document.querySelector('[data-leaderboard-step="1"]').disabled=current.periodEnd>=today();
  if(cached.has(cacheKey))paint(cached.get(cacheKey));
  ensureLoaded(current,force);
 }
 function ensureLoaded(current,force=false){
  if(!window.TKBCloud?.loadLeaderboard)return;
  const cacheKey=`${current.from}:${current.to}`;
  if(loadingKey===cacheKey||(!force&&Date.now()-(loadedAt.get(cacheKey)||0)<30000))return;
  loadingKey=cacheKey;const version=++requestVersion;
  byId('leaderboard-loading').textContent='Đang cập nhật bảng điểm…';byId('leaderboard-error').textContent='';
  window.TKBCloud.loadLeaderboard(current.from,current.to).then(rows=>{
   if(version!==requestVersion||!currentViewer)return;
   cached.set(cacheKey,rows);loadedAt.set(cacheKey,Date.now());paint(rows);
  }).catch(error=>{if(version===requestVersion)byId('leaderboard-error').textContent=error.message||'Chưa tải được bảng xếp hạng.';})
   .finally(()=>{if(version===requestVersion){loadingKey='';byId('leaderboard-loading').textContent='';}});
 }
 function step(direction){
  if(mode==='day')anchor=move(anchor,direction);
  else if(mode==='week')anchor=move(anchor,direction*7);
  else {const date=parse(anchor);date.setUTCMonth(date.getUTCMonth()+direction,1);anchor=key(date);}
  if(period().from>today())anchor=today();draw();
 }
 document.querySelectorAll('[data-leaderboard-range]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.leaderboardRange;anchor=today();draw();}));
 document.querySelectorAll('[data-leaderboard-step]').forEach(button=>button.addEventListener('click',()=>step(Number(button.dataset.leaderboardStep))));
 byId('leaderboard-current').addEventListener('click',()=>{anchor=today();draw();});
 function refresh(force=false){
  const next=today();if(anchor===lastToday)anchor=next;lastToday=next;
  if(!document.hidden&&!byId('leaderboard').hidden&&currentViewer)draw(force);
 }
 window.renderLeaderboard=draw;
 setInterval(()=>refresh(true),30000);
 window.addEventListener('tkb-ranking-change',()=>refresh(true));
 window.addEventListener('focus',()=>refresh(true));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
 draw();
})();
