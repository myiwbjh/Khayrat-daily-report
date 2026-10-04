// SDK owns refresh tokens and persistence. No token is embedded in source/config.
export async function createAuthSession(config, {createClient, fetchImpl=globalThis.fetch, storage=globalThis.localStorage}={}) {
  if(!createClient)({createClient}=await import('../vendor/supabase.mjs'));
  const client=createClient(config.supabaseUrl,config.supabaseAnonKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'implicit',storage},
    global:{fetch:(...args)=>Reflect.apply(fetchImpl,globalThis,args)}
  });
  return new AuthSession(client,{supabaseUrl:config.supabaseUrl});
}

// Read a fresh, user-supplied email link in memory only. Never navigate to it,
// forward its redirect, or accept tokens from another project or auth flow.
export function emailLinkParams(value,supabaseUrl){
  const invalid=()=>new Error('请使用本项目邮件中的完整、尚未打开的登录链接。');
  if(typeof value!=='string'||value.length>4096)throw invalid();
  let link,issuer;try{link=new URL(value.trim());issuer=new URL(supabaseUrl);}catch{throw invalid();}
  const types=link.searchParams.getAll('type');
  const hashes=[...link.searchParams.getAll('token'),...link.searchParams.getAll('token_hash')];
  if(link.protocol!=='https:'||link.origin!==issuer.origin||link.pathname!=='/auth/v1/verify'||link.username||link.password||link.hash||types.length!==1||!['email','magiclink'].includes(types[0])||hashes.length!==1||!/^[A-Za-z0-9_-]{32,256}$/.test(hashes[0]))throw invalid();
  return {token_hash:hashes[0],type:'email'};
}

export class AuthSession {
  constructor(client,{supabaseUrl=''}={}){this.client=client;this.supabaseUrl=supabaseUrl;this.session=null;this.listeners=new Set();this.verifying=false;}
  subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  publish(session){this.session=session;for(const listener of this.listeners)listener(session);}
  async initialize(){
    this.subscription=this.client.auth.onAuthStateChange((_event,session)=>{if(!this.verifying)this.publish(session);}).data.subscription;
    await this.current();return this.session;
  }
  async current(){
    const {data,error}=await this.client.auth.getSession();
    if(error){this.publish(null);throw error;}
    if(!data.session){this.publish(null);return null;}
    const verified=await this.client.auth.getUser();
    if(verified.error){this.publish(null);throw verified.error;}
    this.publish({...data.session,user:verified.data.user});return this.session;
  }
  async signIn(email,redirectTo){
    const {error}=await this.client.auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:redirectTo,shouldCreateUser:false}});
    if(error)throw error;
  }
  async verifyEmailLink(value,email){
    const params=emailLinkParams(value,this.supabaseUrl),expected=String(email||'').trim().toLowerCase();
    if(!expected.includes('@'))throw new Error('请填写接收登录邮件的邮箱。');
    this.verifying=true;
    try{
      const {data,error}=await this.client.auth.verifyOtp(params);
      if(error||!data?.session)throw new Error('verification failed');
      const verified=await this.client.auth.getUser();
      if(verified.error||!verified.data?.user?.email_confirmed_at||verified.data.user.email?.toLowerCase()!==expected)throw new Error('identity mismatch');
      this.publish({...data.session,user:verified.data.user});return this.session;
    }catch{
      try{await this.client.auth.signOut({scope:'local'});}catch{/* Always clear this app's authorization state. */}
      this.publish(null);throw new Error('登录链接已使用、已过期或邮箱不匹配。请重新发送，并验证尚未打开的新链接。');
    }finally{this.verifying=false;}
  }
  async signOut(){const {error}=await this.client.auth.signOut({scope:'local'});if(error)throw error;this.publish(null);}
  dispose(){this.subscription?.unsubscribe();this.listeners.clear();}
}
