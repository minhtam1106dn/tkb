// Deploy with verify_jwt=false. Authentication is performed by Supabase Auth below.
// TKB_PASSWORD_PEPPER is a server-only random secret, never a public browser key.
const roles = new Set(['khoi', 'nhan', 'parents']);
const baseCors = {
 'Access-Control-Allow-Origin': 'https://minhtam1106dn.github.io',
 'Access-Control-Allow-Headers': 'apikey, content-type, authorization',
 'Access-Control-Allow-Methods': 'POST, OPTIONS',
 'Cache-Control': 'no-store',
 'Content-Type': 'application/json',
};
Deno.serve(async request => {
 const origin=request.headers.get('origin')||'';
 const cors={...baseCors,'Access-Control-Allow-Origin':
  ['https://minhtam1106dn.github.io','http://127.0.0.1:8082'].includes(origin)?origin:'https://minhtam1106dn.github.io','Vary':'Origin'};
 if (request.method === 'OPTIONS') return new Response(null, {status:204,headers:cors});
 if (request.method !== 'POST') return new Response('{}', {status:405,headers:cors});
 try {
  if (Number(request.headers.get('content-length') || 0) > 4096) throw new Error('size');
  const body=await request.text();
  if(body.length>4096)throw new Error('size');
  const {role,password,day}=JSON.parse(body);
  if (!roles.has(role) || typeof password!=='string' || !password.length || password.length>256
    || (day!=null && (typeof day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)))) throw new Error('input');
  const pepper=Deno.env.get('TKB_PASSWORD_PEPPER');
  const projectUrl=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  if(!pepper || !projectUrl || !anonKey) return new Response(JSON.stringify({error:'Dịch vụ chưa sẵn sàng.'}),{status:503,headers:cors});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ip=request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';
  const [bucket,digest]=await Promise.all([
   crypto.subtle.sign('HMAC',key,new TextEncoder().encode('login-ip:'+ip)),
   crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${role}:${password}`)),
  ]);
  const limiterRequest=fetch(`${projectUrl}/rest/v1/rpc/tkb_login_attempt`,{
   method:'POST',headers:{apikey:serviceKey!,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},
   body:JSON.stringify({p_bucket:Array.from(new Uint8Array(bucket),b=>b.toString(16).padStart(2,'0')).join('')})});
  const internalPassword=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const authRequest=fetch(`${projectUrl}/auth/v1/token?grant_type=password`,{
   method:'POST',headers:{apikey:anonKey,'Content-Type':'application/json'},
   body:JSON.stringify({email:`${role}@tkb.family.invalid`,password:internalPassword}),
  });
  const [limiter,result]=await Promise.all([limiterRequest,authRequest]);
  if(!limiter.ok)return new Response(JSON.stringify({error:'Dịch vụ chưa sẵn sàng.'}),{status:503,headers:cors});
  if(!await limiter.json())return new Response(JSON.stringify({error:'Thử lại sau 15 phút.'}),{status:429,headers:cors});
  if(!result.ok) return new Response(JSON.stringify({error:result.status===429?'Thử lại sau ít phút.':'Tên hoặc mật khẩu chưa đúng.'}),{status:result.status===429?429:401,headers:cors});
  const session=await result.json();
  const userHeaders={apikey:anonKey,Authorization:`Bearer ${session.access_token}`};
  const taskRequest=day?fetch(`${projectUrl}/rest/v1/tkb_tasks?day=eq.${encodeURIComponent(day)}&select=*`,{headers:userHeaders}):Promise.resolve(null);
  const noteRequest=day?fetch(`${projectUrl}/rest/v1/tkb_parent_notes?day=eq.${encodeURIComponent(day)}&select=day,child,message,updated_at`,{headers:userHeaders}):Promise.resolve(null);
  const [profileResult,scheduleResult,taskResult,noteResult]=await Promise.all([
   fetch(`${projectUrl}/rest/v1/tkb_profiles?select=role`,{headers:userHeaders}),
   fetch(`${projectUrl}/rest/v1/tkb_timetables?select=student,days`,{headers:userHeaders}),
   taskRequest,
   noteRequest,
  ]);
  if(!profileResult.ok)return new Response(JSON.stringify({error:'Dịch vụ chưa sẵn sàng.'}),{status:503,headers:cors});
  const profiles=await profileResult.json();
  if(profiles.length!==1 || profiles[0].role!==role)return new Response(JSON.stringify({error:'Tài khoản chưa được cấu hình đúng quyền.'}),{status:403,headers:cors});
  const bootstrap=scheduleResult.ok && (!taskResult || taskResult.ok) && (!noteResult || noteResult.ok)?{
   role,day:day||null,schedules:await scheduleResult.json(),tasks:taskResult?await taskResult.json():[],notes:noteResult?await noteResult.json():[]
  }:null;
  return new Response(JSON.stringify({...session,bootstrap}),{status:200,headers:cors});
 } catch (_) {
  return new Response(JSON.stringify({error:'Không thể đăng nhập. Vui lòng thử lại.'}),{status:400,headers:cors});
 }
});
