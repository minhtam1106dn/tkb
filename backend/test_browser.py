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
else if(path.includes('tkb_save_catalog')){let t=catalog.find(x=>x.owner===body.p_owner&&x.task_id===body.p_task);if(t){if(body.p_remove)t.retired_on=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());else t.name=body.p_name;t.revision++;}else catalog.push({owner:body.p_owner,task_id:body.p_task,name:body.p_name,active_from:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date()),retired_on:null,revision:1});result=null;}
else if(path.includes('tkb_task_catalog'))result=catalog.filter(t=>testRole==='parents'||t.owner==='shared'||t.owner===testRole);
return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}});
};window.confirm=()=>true;window.testErrors=[];window.addEventListener('error',e=>testErrors.push(e.message));})();'''.replace('CATALOG',json.dumps(catalog))
ev("if(location.origin==='http://127.0.0.1:8765')for(const k of Object.keys(localStorage))if(k.startsWith('tkb-session:')||k.startsWith('tkb-cloud:'))localStorage.removeItem(k)")
call('Page.enable')
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
for owner in ['shared','khoi','nhan']:
 ev(f"document.getElementById('task-owner').value='{owner}';document.getElementById('task-owner').dispatchEvent(new Event('change'))")
 ev("document.getElementById('catalog-name').value='Việc mới kiểm thử';document.getElementById('catalog-form').requestSubmit()");time.sleep(.4)
 check("document.getElementById('catalog-list').textContent.includes('Việc mới kiểm thử')",owner+' create')
 ev("[...document.querySelectorAll('#catalog-list li')].find(x=>x.textContent.includes('Việc mới kiểm thử')).querySelector('button').click();document.getElementById('catalog-name').value='Đã sửa <b>an toàn</b>';document.getElementById('catalog-form').requestSubmit()");time.sleep(.4)
 check("document.getElementById('catalog-list').textContent.includes('Đã sửa <b>an toàn</b>')&&!document.querySelector('#catalog-list b')",owner+' update safely')
 ev("[...document.querySelectorAll('#catalog-list li')].find(x=>x.textContent.includes('Đã sửa')).querySelectorAll('button')[1].click()");time.sleep(.4)
 check("!document.getElementById('catalog-list').textContent.includes('Đã sửa')",owner+' delete')
for width in [375,393,430,768,1024,1440]:
 call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
 check("document.documentElement.scrollWidth<=innerWidth && document.getElementById('task-editor').scrollWidth<=document.getElementById('task-editor').clientWidth",f'no overflow {width}')
click('#catalog-close');click('[data-view="fund"]');time.sleep(.5)
check("document.getElementById('fund-error').textContent===''",'fund no stale login error')
ev("window.testExpire=true;window.renderSnackFund()");time.sleep(.5)
check("testRequests.some(p=>p.includes('/auth/v1/token'))&&document.getElementById('fund-error').textContent===''",'expired access token refreshed')
click('#change-viewer');login('khoi')
check("currentViewer==='khoi'&&TKBCloud.role==='khoi'",'successful viewer switch')
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
