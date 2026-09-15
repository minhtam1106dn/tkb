import json,urllib.request,urllib.error,uuid,datetime,concurrent.futures,os
from pathlib import Path
c=json.loads((Path.home()/'.config/tkb/supabase-private.json').read_text())
def request(path,body=None,token=None,method=None):
 headers={'apikey':c['anon'],'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 if token==c['service_role']:headers['apikey']=token
 req=urllib.request.Request(c['url']+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
 try:
  with urllib.request.urlopen(req,timeout=20) as r:
   text=r.read();return r.status,json.loads(text) if text else None
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
def rpc(token,owner,task,done,revision,op=None,note=None):
 return request('/rest/v1/rpc/tkb_set_task',{'p_day':day,'p_owner':owner,'p_task':task,'p_complete':done,'p_note':note,'p_operation_id':op or str(uuid.uuid4()),'p_expected_revision':revision,'p_changed_at':now},token)
now=datetime.datetime.now(datetime.timezone.utc).isoformat();day=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=7)).date().isoformat()
sessions={}
for role in ['khoi','nhan','parents']:
 code,data=request('/functions/v1/tkb-login',{'role':role,'password':os.environ['PW_'+role]});assert code==200,(role,code,data)
 sessions[role]=data['access_token']
 code,rows=request('/rest/v1/tkb_timetables?select=student',token=sessions[role]);assert code==200 and {x['student'] for x in rows}==({'khoi','nhan'} if role=='parents' else {role})
assert request('/functions/v1/tkb-login',{'role':'khoi','password':'wrong-test-password'})[0]==401
assert request('/rest/v1/tkb_tasks?select=*')[0] in (401,403)
assert request('/auth/v1/signup',{'email':'disabled@example.com','password':'long-random-test-password'})[0] in (400,422)
assert request('/rest/v1/rpc/tkb_login_attempt',{'p_bucket':'a'*64},sessions['khoi'])[0] in (401,403,404)
assert rpc(sessions['parents'],'shared','fish',True,0)[0]==403
assert rpc(sessions['khoi'],'nhan','bath',True,0)[0]==403
assert request('/rest/v1/tkb_profiles',{'user_id':str(uuid.uuid4()),'role':'parents'},sessions['khoi'])[0]==403
# Test one previously absent shared task; delete only the test record after verification.
path='/rest/v1/tkb_tasks?day=eq.'+day+'&owner=eq.shared&task_id=eq.fish'
assert request(path,token=c['service_role'])[1]==[], 'Task exists; will not overwrite household data'
try:
 with concurrent.futures.ThreadPoolExecutor() as pool:
  results=list(pool.map(lambda role:(role,rpc(sessions[role],'shared','fish',True,0)),['khoi','nhan']))
 winners=[(role,result) for role,(code,result) in results if code==200 and not result['conflict']]
 assert len(winners)==1,results
 actor,row=winners[0];other='nhan' if actor=='khoi' else 'khoi'
 assert rpc(sessions[other],'shared','fish',False,1)[1]['conflict']
 for role in sessions:assert request(path,token=sessions[role])[1][0]['completed_by']==actor
 op=str(uuid.uuid4());code,undone=rpc(sessions[actor],'shared','fish',False,1,op)
 assert code==200 and not undone['conflict'] and not undone['record']['completed']
 assert rpc(sessions[actor],'shared','fish',False,1,op)[1]==undone,'Retry must be idempotent'
 assert rpc(sessions[other],'shared','fish',True,1)[1]['conflict'],'Stale revision must fail'
 assert not rpc(sessions[other],'shared','fish',True,2)[1]['conflict']
finally:
 rows=request(path,token=c['service_role'])[1]
 if rows and rows[0]['revision']<=3:assert request(path+'&revision=eq.'+str(rows[0]['revision']),token=c['service_role'],method='DELETE')[0]==204
print('PASS: all three passwords; wrong password; signup disabled; anonymous denied; per-child schedules; parents read-only; no role escalation; race, owner-only undo, idempotency, stale conflict and three-session visibility.')
