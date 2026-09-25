(() => {
 'use strict';
 const byId=id=>document.getElementById(id);
 const zone='Asia/Ho_Chi_Minh';
 const money=new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0});
 const fullDate=new Intl.DateTimeFormat('vi-VN',{timeZone:zone,weekday:'long',day:'numeric',month:'numeric',year:'numeric'});
 const dateKey=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;};
 let selectedDate=dateKey(),loading=false,loadedAt=0;
 const name=child=>child==='khoi'?'Thanh Khôi':'Thanh Nhân';
 function setFormRole(){
  const parent=currentViewer==='parents';
  byId('fund-item-label').textContent=parent?'Khoản tiền Ba Mẹ cho':'Mặt hàng đã mua';
  byId('fund-item').placeholder=parent?'Ví dụ: Tiền ăn vặt tuần này':'Ví dụ: Bánh mì, sữa…';
  byId('fund-submit').textContent=parent?'Nạp tiền vào quỹ':'Thêm khoản chi';
 }
 function render(){
  if(!currentViewer)return;
  const rows=window.TKBCloud?.getSnackFund()||[];
  const income=rows.filter(x=>x.kind==='income').reduce((sum,x)=>sum+Number(x.amount),0);
  const expense=rows.filter(x=>x.kind==='expense').reduce((sum,x)=>sum+Number(x.amount),0);
  byId('fund-balance').textContent=money.format(income-expense);
  byId('fund-income').textContent=money.format(income);
  byId('fund-expense').textContent=money.format(expense);
  byId('fund-balance').classList.toggle('negative',income-expense<0);
  byId('fund-date').value=selectedDate;byId('fund-date').max=dateKey();
  byId('fund-day-title').textContent=fullDate.format(new Date(selectedDate+'T12:00:00Z'));
  setFormRole();
  const dayRows=rows.filter(row=>row.day===selectedDate);
  const daySpent=dayRows.filter(row=>row.kind==='expense').reduce((sum,row)=>sum+Number(row.amount),0);
  const dayIncome=dayRows.filter(row=>row.kind==='income').reduce((sum,row)=>sum+Number(row.amount),0);
  byId('fund-day-total').textContent=`+${money.format(dayIncome)} · −${money.format(daySpent)}`;
  const list=byId('fund-list');list.replaceChildren();
  if(!dayRows.length){const empty=document.createElement('li');empty.className='fund-empty';empty.textContent='Chưa có giao dịch trong ngày này.';list.append(empty);}
  for(const row of dayRows){
   const li=document.createElement('li');li.className=`fund-row ${row.kind}`;
   const mark=document.createElement('span');mark.className='fund-mark';mark.textContent=row.kind==='income'?'+':'−';mark.setAttribute('aria-hidden','true');
   const copy=document.createElement('div');copy.className='fund-copy';
   const title=document.createElement('strong');title.textContent=row.item;
   const meta=document.createElement('span');meta.textContent=row.kind==='income'?'Ba Mẹ nạp quỹ':`${name(row.child)} đã mua`;
   copy.append(title,meta);
   const amount=document.createElement('strong');amount.className='fund-row-amount';amount.textContent=`${row.kind==='income'?'+':'−'}${money.format(Number(row.amount))}`;
   li.append(mark,copy,amount);
   const canDelete=currentViewer==='parents'||(row.kind==='expense'&&row.child===currentViewer&&row.day===dateKey());
   if(canDelete){const button=document.createElement('button');button.type='button';button.className='fund-delete';button.dataset.fundDelete=row.id;button.textContent='Xóa';button.setAttribute('aria-label',`Xóa ${row.item}, ${money.format(Number(row.amount))}`);li.append(button);}
   list.append(li);
  }
 }
 async function load(force=false,quiet=false){
  if(!currentViewer || window.TKBCloud?.role!==currentViewer)return;
  const role=currentViewer;
  if(loading || (!force&&Date.now()-loadedAt<30000))return;
  loading=true;if(!quiet)byId('fund-feedback').textContent='Đang cập nhật quỹ…';
  try{await window.TKBCloud.loadSnackFund();loadedAt=Date.now();byId('fund-error').textContent='';if(!quiet)byId('fund-feedback').textContent='';}
  catch(error){if(currentViewer===role && window.TKBCloud?.role===role)byId('fund-error').textContent=error.message||'Chưa tải được quỹ ăn vặt.';}
  finally{loading=false;render();}
 }
 function open(){render();void load(true);}
 byId('fund-form').addEventListener('submit',async event=>{
  event.preventDefault();const item=byId('fund-item'),amount=byId('fund-amount'),button=byId('fund-submit');
  const value=Number(amount.value);byId('fund-error').textContent='';byId('fund-feedback').textContent='';
  if(!item.value.trim()||!Number.isInteger(value)||value<1000||value>10000000){byId('fund-error').textContent='Nhập tên mặt hàng và số tiền từ 1.000 ₫ đến 10.000.000 ₫.';return;}
  button.disabled=true;button.textContent='Đang lưu…';
  try{
   await window.TKBCloud.addSnackTransaction(selectedDate,currentViewer==='parents'?'income':'expense',item.value,value);
   item.value='';amount.value='';loadedAt=Date.now();byId('fund-feedback').textContent=currentViewer==='parents'?'Đã nạp tiền vào quỹ.':'Đã ghi khoản chi.';
  }catch(error){byId('fund-error').textContent=error.message||'Chưa lưu được giao dịch.';}
  finally{button.disabled=false;setFormRole();render();item.focus();}
 });
 byId('fund-list').addEventListener('click',async event=>{
  const button=event.target.closest('[data-fund-delete]');if(!button||button.disabled)return;
  button.disabled=true;byId('fund-error').textContent='';
  try{await window.TKBCloud.deleteSnackTransaction(button.dataset.fundDelete);byId('fund-feedback').textContent='Đã xóa giao dịch.';}
  catch(error){button.disabled=false;byId('fund-error').textContent=error.message||'Chưa xóa được giao dịch.';}
 });
 byId('fund-date').addEventListener('change',event=>{if(event.target.value&&event.target.value<=dateKey()){selectedDate=event.target.value;render();}else event.target.value=selectedDate;});
 document.querySelectorAll('[data-fund-step]').forEach(button=>button.addEventListener('click',()=>{const date=new Date(selectedDate+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+Number(button.dataset.fundStep));const next=date.toISOString().slice(0,10);if(next<=dateKey()){selectedDate=next;render();}}));
 byId('fund-today').addEventListener('click',()=>{selectedDate=dateKey();render();});
 window.renderSnackFund=open;
 window.TKBCloud?.subscribe(()=>{if(!byId('fund').hidden)render();});
 setInterval(()=>{if(!document.hidden&&!byId('fund').hidden)void load(true,true);},5000);
 window.addEventListener('focus',()=>{if(!byId('fund').hidden)void load(true,true);});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!byId('fund').hidden)void load(true,true);});
})();
