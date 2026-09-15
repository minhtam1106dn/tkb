#!/usr/bin/env python3
"""Provision only this app's 3 Supabase accounts, profiles and timetables.
Secrets are read from environment; no passwords or tokens are printed or saved.
Run schema.sql and deploy the login function first. Set the same pepper there.
"""
import hashlib, hmac, json, os, urllib.request, urllib.error
from pathlib import Path
URL=os.environ['TKB_SUPABASE_URL'].rstrip('/')
KEY=os.environ['TKB_SERVICE_ROLE_KEY']
PEPPER=os.environ['TKB_PASSWORD_PEPPER']

def request(path, data=None, method=None, prefer=None):
    headers={'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'}
    if prefer: headers['Prefer']=prefer
    req=urllib.request.Request(URL+path,headers=headers,data=None if data is None else json.dumps(data).encode(),method=method)
    try:
        with urllib.request.urlopen(req,timeout=30) as response:
            raw=response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Provisioning failed: HTTP {error.code} on {path.split("?")[0]}') from None

existing={}
page=1
while True:
    users=request('/auth/v1/admin/users?page='+str(page)+'&per_page=100')['users']
    existing.update({u.get('email'):u['id'] for u in users})
    if len(users)<100: break
    page+=1
for role in ['khoi','nhan','parents']:
    password=os.environ['TKB_PASSWORD_'+role.upper()]
    derived=hmac.new(PEPPER.encode(),f'{role}:{password}'.encode(),hashlib.sha256).hexdigest()
    email=role+'@tkb.family.invalid'
    user_id=existing.get(email)
    if user_id:
        request('/auth/v1/admin/users/'+user_id,{'password':derived,'email_confirm':True},'PUT')
    else:
        user_id=request('/auth/v1/admin/users',{'email':email,'password':derived,'email_confirm':True},'POST')['id']
    request('/rest/v1/tkb_profiles?on_conflict=user_id',{'user_id':user_id,'role':role},'POST','resolution=merge-duplicates')
for student,days in json.loads(Path(__file__).with_name('timetables.json').read_text()).items():
    request('/rest/v1/tkb_timetables?on_conflict=student',{'student':student,'days':days},'POST','resolution=merge-duplicates')
print('Provisioned 3 accounts, roles and 2 timetables. No secrets written to source.')
