import {ApiError} from './ai-auth.js';
export async function projectAuth(request,{env=process.env,fetchImpl=fetch,editor=false,admin=false}={}){
 const token=/^Bearer ([A-Za-z0-9._~-]+)$/i.exec(request.headers?.authorization||'')?.[1];
 if(!token)throw new ApiError(401,'请先登录');
 const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_ANON_KEY;
 if(!base?.startsWith('https://')||!key)throw new ApiError(503,'Authentication unavailable');
 const headers={apikey:key,Authorization:`Bearer ${token}`};
 const get=async path=>{const r=await fetchImpl(base+path,{headers,signal:AbortSignal.timeout(10000)});if(!r.ok)throw new ApiError(path==='/auth/v1/user'?401:403,'Project access denied');return r.json();};
 const user=await get('/auth/v1/user');if(!user.id||!user.email_confirmed_at)throw new ApiError(403,'Verified sign-in required');
 const rows=await get(`/rest/v1/project_members?project_id=eq.khayrat&user_id=eq.${encodeURIComponent(user.id)}&select=role,is_admin`),member=rows?.[0];
 if(!['reader','editor'].includes(member?.role)||(editor&&member.role!=='editor')||(admin&&member.is_admin!==true))throw new ApiError(403,'Account has no project permission');
 return {user,member,headers,base};
}
export function serviceAccess(env=process.env){const base=env.SUPABASE_URL?.replace(/\/$/,''),key=env.SUPABASE_SERVICE_ROLE_KEY;if(!base?.startsWith('https://')||!key)throw new ApiError(503,'Server publication/account service not configured');return {base,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'}};}
export async function rest(path,options={},env=process.env,fetchImpl=fetch){const {base,headers}=serviceAccess(env);const r=await fetchImpl(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new ApiError(502,'Project service request failed');return r.status===204?null:r.json();}
