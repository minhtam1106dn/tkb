# Run against an idle dedicated Chrome tab after browser-ready. Local server: 127.0.0.1:8765.
# Network fixtures stay on the local origin. Does not write family data.
import json,urllib.request,websocket,sys
pages=json.load(urllib.request.urlopen('http://127.0.0.1:49222/json/list'))
p=next(p for p in pages if p['type']=='page')
assert p['url'].startswith(('http://127.0.0.1:8765/', 'about:blank')), 'Open an idle local test tab first'
w=websocket.create_connection(p['webSocketDebuggerUrl'],suppress_origin=True,timeout=45)
def call(method,params={}):
 w.send(json.dumps({'id':1,'method':method,'params':params}))
 while True:
  r=json.loads(w.recv())
  if r.get('id')==1:return r

def ev(expression):
 r=call('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':True})
 if 'exceptionDetails' in r.get('result',{}):raise RuntimeError(r['result']['exceptionDetails'])
 return r.get('result',{}).get('result',{}).get('value')

from pathlib import Path
import time,re
root=Path(__file__).resolve().parent.parent
rows=re.findall(r"\('(shared|khoi|nhan)','([^']+)','([^']+)',(\d+),'2000-01-01'\)",(root/'backend/schema.sql').read_text())
catalog=[dict(owner=o,task_id=i,name=n,position=int(p),active_from='2000-01-01',retired_on=None,revision=1) for o,i,n,p in rows]
source='''(()=>{const original=window.fetch;let catalog=CATALOG;window.testRequests=[];window.testRole=null;
window.fetch=async(input,options={})=>{const url=String(input);if(!url.includes('supabase.co'))return original(input,options);if(options.method==='OPTIONS')return new Response('{}');const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};testRequests.push(path);
let result=[];let status=200;if(window.testExpire&&path.includes('tkb_snack_fund')){window.testExpire=false;return new Response('{}',{status:401});}
if(path.includes('tkb-login')){if(body.password==='wrong')return new Response('{}',{status:401});testRole=body.role;result={access_token:'test-token',refresh_token:'test-refresh',user:{id:body.role},bootstrap:{catalog:catalog.filter(t=>body.role==='parents'||t.owner==='shared'||t.owner===body.role),role:body.role,day:body.day,schedules:[],tasks:[],notes:[]}};}
else if(path.includes('/auth/v1/token')){testRole=JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('tkb-session:')))).role;result={access_token:'test-token',refresh_token:'test-refresh',user:{id:testRole}};}
else if(path.includes('tkb_profiles'))result=[{role:testRole}];
else if(path.includes('tkb_reorder_catalog')){let t=catalog.find(x=>x.kind==='order'&&x.owner===body.p_owner&&x.scope===body.p_scope&&x.day===body.p_day);if(t){t.task_ids=body.p_ids;t.revision++;}else catalog.push({kind:'order',owner:body.p_owner,scope:body.p_scope,day:body.p_day,task_ids:body.p_ids,revision:1});result=null;}
else if(path.includes('tkb_save_daily_catalog')){let t=catalog.find(x=>x.day===body.p_day&&x.owner===body.p_owner&&x.task_id===body.p_task);if(t){t.name=body.p_name;t.removed=body.p_remove;t.revision++;}else catalog.push({day:body.p_day,owner:body.p_owner,task_id:body.p_task,name:body.p_name,removed:body.p_remove,revision:1,position:100});result=null;}
else if(path.includes('tkb_save_catalog')){let t=catalog.find(x=>x.owner===body.p_owner&&x.task_id===body.p_task);if(t){if(body.p_remove)t.retired_on=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());else t.name=body.p_name;t.revision++;}else catalog.push({owner:body.p_owner,task_id:body.p_task,name:body.p_name,active_from:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date()),retired_on:null,revision:1});result=null;}
else if(path.includes('tkb_catalog_entries'))result=catalog.filter(t=>testRole==='parents'||t.owner==='shared'||t.owner===testRole);
return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}});
};window.confirm=()=>true;window.testErrors=[];window.addEventListener('error',e=>testErrors.push(e.message));})();'''.replace('CATALOG',json.dumps(catalog))
ev("if(location.origin==='http://127.0.0.1:8765')for(const k of Object.keys(localStorage))if(k.startsWith('tkb-session:')||k.startsWith('tkb-cloud:'))localStorage.removeItem(k)")
call('Page.enable')
call('Page.bringToFront')
call('Emulation.setDeviceMetricsOverride',{'width':375,'height':812,'deviceScaleFactor':1,'mobile':False})
call('Network.enable')
call('Network.setCacheDisabled',{'cacheDisabled':True})
call('Network.setBypassServiceWorker',{'bypass':True})
call('Page.addScriptToEvaluateOnNewDocument',{'source':source})
call('Page.navigate',{'url':'http://127.0.0.1:8765/'})
time.sleep(2)
def check(expr,label):
 if not ev(expr):raise AssertionError(label)
 print('PASS',label)
def click(selector):ev(f'document.querySelector({json.dumps(selector)}).click()');time.sleep(.2)
def login(role,pw='ok'):
 click('[data-viewer="'+role+'"]');ev(f"document.getElementById('login-password').value={json.dumps(pw)};document.getElementById('login-form').requestSubmit()");time.sleep(.6)
check("document.getElementById('viewer-dialog').open",'initial login')
check("document.getElementById('viewer-cancel').hidden",'no cancel before sign-in')
ev("window.renderSnackFund()")
check("!testRequests.some(p=>p.includes('tkb_snack_fund'))",'no fund request before authentication')
login('parents')
check("currentViewer==='parents' && TKBCloud.role==='parents' && !document.getElementById('viewer-dialog').open",'parent login')
click('#change-viewer');check("TKBCloud.role==='parents' && !document.getElementById('viewer-cancel').hidden",'switch keeps authenticated session')
login('nhan','wrong');check("currentViewer==='parents'&&TKBCloud.role==='parents'",'failed switch preserves current viewer')
click('#viewer-cancel');check("!document.getElementById('viewer-dialog').open&&currentViewer==='parents'",'cancel returns to parent')
click('[data-view="checklist"]');click('#manage-tasks')
ev("document.getElementById('catalog-scope').value='future';document.getElementById('catalog-scope').dispatchEvent(new Event('change'))")
click('#catalog-scope-trigger')
check("!document.getElementById('catalog-scope-options').hidden&&document.getElementById('catalog-scope-trigger').getAttribute('aria-expanded')==='true'",'custom dropdown opens')
ev("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
check("document.getElementById('catalog-scope-options').hidden&&document.getElementById('task-editor').open",'Escape closes dropdown only')
for owner in ['shared','khoi','nhan']:
 ev(f"document.getElementById('task-owner').value='{owner}';document.getElementById('task-owner').dispatchEvent(new Event('change'))")
 ev("document.getElementById('catalog-name').value='Việc mới kiểm thử';document.getElementById('catalog-form').requestSubmit()");time.sleep(.4)
 check("document.getElementById('catalog-list').textContent.includes('Việc mới kiểm thử')",owner+' create')
 ev("[...document.querySelectorAll('#catalog-list li')].find(x=>x.textContent.includes('Việc mới kiểm thử')).querySelector('[data-action=edit]').click();document.getElementById('catalog-name').value='Đã sửa <b>an toàn</b>';document.getElementById('catalog-form').requestSubmit()");time.sleep(.4)
 check("document.getElementById('catalog-list').textContent.includes('Đã sửa <b>an toàn</b>')&&!document.querySelector('#catalog-list b')",owner+' update safely')
 ev("[...document.querySelectorAll('#catalog-list li')].find(x=>x.textContent.includes('Đã sửa')).querySelector('[data-action=delete]').click()");time.sleep(.4)
 check("!document.getElementById('catalog-list').textContent.includes('Đã sửa')",owner+' delete')
click('#catalog-close')
ev("document.getElementById('checklist-date').value='2026-09-21';document.getElementById('checklist-date').dispatchEvent(new Event('change'))")
click('#manage-tasks')
check("document.getElementById('catalog-scope').value==='day'&&document.getElementById('catalog-scope-note').textContent.includes('21/09/2026')",'selected date scope')
for owner in ['shared','khoi','nhan']:
 ev(f"document.getElementById('task-owner').value='{owner}';document.getElementById('task-owner').dispatchEvent(new Event('change'))")
 ev("document.getElementById('catalog-name').value='Chỉ riêng thứ Hai';document.getElementById('catalog-form').requestSubmit()");time.sleep(.4)
 check(f"TKBCloud.catalogForDay('{owner}','2026-09-21').some(t=>t.name==='Chỉ riêng thứ Hai')&&!TKBCloud.catalogForDay('{owner}','2026-09-22').some(t=>t.name==='Chỉ riêng thứ Hai')",owner+' daily add isolation')
 ev("[...document.querySelectorAll('#catalog-list li')].find(x=>x.textContent.includes('Chỉ riêng thứ Hai')).querySelector('[data-action=edit]').click();document.getElementById('catalog-name').value='Tên riêng đã sửa';document.getElementById('catalog-form').requestSubmit()");time.sleep(.4)
 check("document.getElementById('catalog-list').textContent.includes('Tên riêng đã sửa')",owner+' daily edit')
 ev("[...document.querySelectorAll('#catalog-list li')].find(x=>x.textContent.includes('Tên riêng đã sửa')).querySelector('[data-action=delete]').click()");time.sleep(.4)
 check("!document.getElementById('catalog-list').textContent.includes('Tên riêng đã sửa')",owner+' daily delete')
# Removing a regular task is also isolated to that date.
ev("document.getElementById('task-owner').value='khoi';document.getElementById('task-owner').dispatchEvent(new Event('change'));[...document.querySelectorAll('#catalog-list li')].find(x=>x.textContent.includes('Tắm rửa')).querySelector('[data-action=delete]').click()");time.sleep(.4)
check("!TKBCloud.catalogForDay('khoi','2026-09-21').some(t=>t.task_id==='bath')&&TKBCloud.catalogForDay('khoi','2026-09-22').some(t=>t.task_id==='bath')",'daily deletion keeps next day')
# Daily reordering persists without changing the next day's order.
ev("window.nextDayOrder=TKBCloud.catalogForDay('khoi','2026-09-22').map(t=>t.task_id).join(',');window.beforeOrder=TKBCloud.catalogForDay('khoi','2026-09-21').map(t=>t.task_id);document.querySelector('#catalog-list [data-move=\"1\"]').click()");time.sleep(.4)
check("TKBCloud.catalogForDay('khoi','2026-09-21')[1].task_id===beforeOrder[0]&&TKBCloud.catalogForDay('khoi','2026-09-22').map(t=>t.task_id).join(',')===nextDayOrder",'daily reorder persists and isolates dates')
# Real mouse drag through CDP, rather than invoking a reorder handler.
ev("document.getElementById('catalog-list').scrollIntoView({block:'start'});window.dragBefore=TKBCloud.catalogForDay('khoi','2026-09-21').map(t=>t.task_id)")
coords=ev("(()=>{const rows=[...document.querySelectorAll('#catalog-list li')];const a=rows[0].querySelector('.catalog-drag').getBoundingClientRect(),b=rows[1].getBoundingClientRect();return {x:a.x+a.width/2,y:a.y+a.height/2,end:b.bottom-4}})()")
call('Input.dispatchMouseEvent',{'type':'mouseReleased','x':coords['x'],'y':coords['y'],'button':'left','buttons':0})
call('Input.dispatchMouseEvent',{'type':'mouseMoved','x':coords['x'],'y':coords['y'],'buttons':0})
call('Input.dispatchMouseEvent',{'type':'mousePressed','x':coords['x'],'y':coords['y'],'button':'left','buttons':1,'clickCount':1})
time.sleep(.1)
call('Input.dispatchMouseEvent',{'type':'mouseMoved','x':coords['x'],'y':coords['end'],'button':'left','buttons':1})
time.sleep(.15)
call('Input.dispatchMouseEvent',{'type':'mouseReleased','x':coords['x'],'y':coords['end'],'button':'left','buttons':0,'clickCount':1})
time.sleep(.5)
check("TKBCloud.catalogForDay('khoi','2026-09-21')[0].task_id!==dragBefore[0]",'mouse drag reorders')
# Touch drag uses the same handle without blocking normal list scrolling.
ev("document.getElementById('catalog-list').scrollIntoView({block:'start'});window.touchBefore=TKBCloud.catalogForDay('khoi','2026-09-21').map(t=>t.task_id)")
coords=ev("(()=>{const rows=[...document.querySelectorAll('#catalog-list li')];const a=rows[0].querySelector('.catalog-drag').getBoundingClientRect(),b=rows[1].getBoundingClientRect();return {x:a.x+a.width/2,y:a.y+a.height/2,end:b.bottom-4}})()")
call('Page.bringToFront')
call('Emulation.setDeviceMetricsOverride',{'width':375,'height':812,'deviceScaleFactor':1,'mobile':True})
call('Emulation.setTouchEmulationEnabled',{'enabled':True,'maxTouchPoints':1})
call('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':coords['x'],'y':coords['y'],'id':1}]})
call('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':coords['x'],'y':coords['end'],'id':1}]})
time.sleep(.1)
call('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
time.sleep(.5)
check("TKBCloud.catalogForDay('khoi','2026-09-21')[0].task_id!==touchBefore[0]",'touch drag reorders')
call('Emulation.setTouchEmulationEnabled',{'enabled':False})
for width in [375,393,430,768,1024,1440]:
 call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
 check("document.documentElement.scrollWidth<=innerWidth && document.getElementById('task-editor').scrollWidth<=document.getElementById('task-editor').clientWidth",f'no overflow {width}')
click('#catalog-close');click('#checklist-today');click('[data-view="fund"]');time.sleep(.5)
check("document.getElementById('fund-error').textContent===''",'fund no stale login error')
ev("window.testExpire=true;window.renderSnackFund()");time.sleep(.5)
check("testRequests.some(p=>p.includes('/auth/v1/token'))&&document.getElementById('fund-error').textContent===''",'expired access token refreshed')
click('#change-viewer');login('khoi')
check("currentViewer==='khoi'&&TKBCloud.role==='khoi'",'successful viewer switch')
for width in [1100,1280,1440]:
 call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
 check("(()=>{const r=document.createRange();r.selectNodeContents(document.getElementById('student-name'));return r.getClientRects().length===1&&document.documentElement.scrollWidth<=innerWidth})()",f'desktop name one line {width}')
click('[data-view="checklist"]');check("document.getElementById('task-management').hidden",'child cannot manage catalog')
check("document.querySelectorAll('#private-tasks li').length===6",'Khoi private tasks')
click('#change-viewer');login('nhan');click('[data-view="checklist"]')
check("document.querySelectorAll('#private-tasks li').length===5",'Nhan private tasks')
call('Page.reload',{'ignoreCache':True});time.sleep(1)
check("currentViewer==='nhan'&&TKBCloud.role==='nhan'",'restore session on reload')
check("testErrors.length===0",'no browser errors')
ev("TKBCloud.logout()")
check("currentViewer===null&&document.getElementById('app').hidden&&document.getElementById('viewer-dialog').open",'sign-out updates UI')
print('UI TESTS PASSED')
