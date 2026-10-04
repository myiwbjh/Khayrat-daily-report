import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthSession,emailLinkParams} from '../src/auth.js';

const issuer='https://qa.supabase.test',hash='a'.repeat(64);
const link=`${issuer}/auth/v1/verify?token=${hash}&type=magiclink&redirect_to=https://untrusted.test/`;
test('email link verification accepts only current issuer and ignores its redirect',()=>{
  assert.deepEqual(emailLinkParams(link,issuer),{token_hash:hash,type:'email'});
  assert.deepEqual(emailLinkParams(`${issuer}/auth/v1/verify?token_hash=${hash}&type=email`,issuer),{token_hash:hash,type:'email'});
  for(const invalid of [link.replace(issuer,'https://other.supabase.test'),link.replace('https:','http:'),link.replace('/verify','/token'),link.replace('magiclink','recovery'),link.replace('magiclink','signup'),link+'&token_hash='+hash,link+'&type=email',link+'#access_token=synthetic',link.replace('https://','https://user:pass@'),'not a URL',link.replace(hash,'123456'),'x'.repeat(4097)])assert.throws(()=>emailLinkParams(invalid,issuer),/本项目/);
});
function stub({email='qa@example.test',confirmed=true,fail=false}={}){
  const calls=[],session={access_token:'synthetic-only'},user={id:'synthetic-user',email,email_confirmed_at:confirmed?'2026-10-04T00:00:00Z':null};let listener;
  const client={auth:{onAuthStateChange:fn=>(listener=fn,{data:{subscription:{unsubscribe(){}}}}),getSession:async()=>({data:{session:null}}),verifyOtp:async params=>{calls.push(['verify',params]);listener?.('SIGNED_IN',session);return fail?{error:new Error('private upstream '+link)}:{data:{session}};},getUser:async()=>(calls.push(['user']),{data:{user}}),signOut:async options=>(calls.push(['signout',options]),{})}};
  return {auth:new AuthSession(client,{supabaseUrl:issuer}),calls};
}
test('fresh email link creates a verified matching session without publishing intermediate authorization',async()=>{
  const {auth,calls}=stub(),events=[];await auth.initialize();auth.subscribe(s=>events.push(s));
  const session=await auth.verifyEmailLink(link,' QA@example.test ');
  assert.equal(session.user.email,'qa@example.test');assert.equal(events.length,1);
  assert.deepEqual(calls,[['verify',{token_hash:hash,type:'email'}],['user']]);
});
test('foreign links and missing email never reach Supabase verification',async()=>{
  const {auth,calls}=stub();await assert.rejects(()=>auth.verifyEmailLink(link.replace(issuer,'https://attacker.test'),'qa@example.test'),/本项目/);
  await assert.rejects(()=>auth.verifyEmailLink(link,''),/邮箱/);assert.deepEqual(calls,[]);
});
test('used links, unconfirmed users and a different email clear local session with a sanitized error',async()=>{
  for(const opts of [{fail:true},{confirmed:false},{email:'another@example.test'}]){
    const {auth,calls}=stub(opts),events=[];await auth.initialize();auth.subscribe(s=>events.push(s));
    await assert.rejects(()=>auth.verifyEmailLink(link,'qa@example.test'),error=>/已使用/.test(error.message)&&!error.message.includes(hash)&&!error.message.includes('private upstream'));
    assert.equal(auth.session,null);assert.ok(events.every(s=>s===null));assert.deepEqual(calls.at(-1),['signout',{scope:'local'}]);
  }
});
