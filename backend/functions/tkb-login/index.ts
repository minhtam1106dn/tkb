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
  const {role,password}=JSON.parse(body);
  if (!roles.has(role) || typeof password!=='string' || !password.length || password.length>256) throw new Error('input');
  const pepper=Deno.env.get('TKB_PASSWORD_PEPPER');
  const projectUrl=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  if(!pepper || !projectUrl || !anonKey) return new Response(JSON.stringify({error:'Dịch vụ chưa sẵn sàng.'}),{status:503,headers:cors});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ip=request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';
  const bucket=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('login-ip:'+ip));
  const limiter=await fetch(`${projectUrl}/rest/v1/rpc/tkb_login_attempt`,{
   method:'POST',headers:{apikey:serviceKey!,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},
   body:JSON.stringify({p_bucket:Array.from(new Uint8Array(bucket),b=>b.toString(16).padStart(2,'0')).join('')})});
  if(!limiter.ok)return new Response(JSON.stringify({error:'Dịch vụ chưa sẵn sàng.'}),{status:503,headers:cors});
  if(!await limiter.json())return new Response(JSON.stringify({error:'Thử lại sau 15 phút.'}),{status:429,headers:cors});
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${role}:${password}`));
  const internalPassword=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const result=await fetch(`${projectUrl}/auth/v1/token?grant_type=password`,{
   method:'POST',headers:{apikey:anonKey,'Content-Type':'application/json'},
   body:JSON.stringify({email:`${role}@tkb.family.invalid`,password:internalPassword}),
  });
  if(!result.ok) return new Response(JSON.stringify({error:result.status===429?'Thử lại sau ít phút.':'Tên hoặc mật khẩu chưa đúng.'}),{status:result.status===429?429:401,headers:cors});
  return new Response(await result.text(),{status:200,headers:cors});
 } catch (_) {
  return new Response(JSON.stringify({error:'Không thể đăng nhập. Vui lòng thử lại.'}),{status:400,headers:cors});
 }
});
