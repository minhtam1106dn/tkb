#!/usr/bin/env python3
"""Apply TKB schema/function using the existing Supabase dashboard Chrome session.
Run browser-ready.py first. Requires websocket-client; never prints credentials.
Secrets live in ~/.config/tkb/supabase-private.json, outside this repository.
"""
import argparse,json,urllib.request,urllib.error,websocket
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=49222)
parser.add_argument('--schema',action='store_true')
parser.add_argument('--function',action='store_true')
args=parser.parse_args()
if not (args.schema or args.function):parser.error('Choose --schema and/or --function')
config=json.loads((Path.home()/'.config/tkb/supabase-private.json').read_text())
assert config['ref']=='sundoeijcnaqunpsajgr', 'Unexpected project'
with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/json/list') as r:pages=json.load(r)
page=next(p for p in pages if p['type']=='page' and p['url'].startswith('https://supabase.com/dashboard'))
w=websocket.create_connection(page['webSocketDebuggerUrl'],suppress_origin=True,timeout=60)
def ev(expression):
 w.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expression,'returnByValue':True,'awaitPromise':True}}))
 while True:
  result=json.loads(w.recv())
  if result.get('id')==1:
   if 'error' in result or 'exceptionDetails' in result.get('result',{}):raise RuntimeError('Dashboard request failed; check login and retry.')
   return result['result']['result'].get('value')
def api(path,body):
 result=ev("""(async()=>{const s=JSON.parse(localStorage.getItem('supabase.dashboard.auth.token'));const r=await fetch('https://api.supabase.com/v1/projects/sundoeijcnaqunpsajgr'+PATH,{method:'POST',headers:{Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(BODY)});return {status:r.status,error:r.ok?null:await r.text()}})()""".replace('PATH',json.dumps(path)).replace('BODY',json.dumps(body)))
 if result['status']>=300:raise RuntimeError(str(result))
root=Path(__file__).parent
if args.schema:
 api('/database/query',{'query':(root/'schema.sql').read_text()});print('Schema applied.')
if args.function:
 api('/secrets',[{'name':'TKB_PASSWORD_PEPPER','value':config['pepper']}])
 result=ev("""(async()=>{const s=JSON.parse(localStorage.getItem('supabase.dashboard.auth.token'));const form=new FormData();form.append('metadata',JSON.stringify({name:'tkb-login',entrypoint_path:'index.ts',verify_jwt:false}));form.append('file',new Blob([SOURCE],{type:'application/typescript'}),'index.ts');const r=await fetch('https://api.supabase.com/v1/projects/sundoeijcnaqunpsajgr/functions/deploy?slug=tkb-login',{method:'POST',headers:{Authorization:'Bearer '+s.access_token},body:form});return {status:r.status,error:r.ok?null:await r.text()}})()""".replace('SOURCE',json.dumps((root/'functions/tkb-login/index.ts').read_text())))
 if result['status']>=300:raise RuntimeError(str(result))
 print('Login function deployed.')
w.close()
