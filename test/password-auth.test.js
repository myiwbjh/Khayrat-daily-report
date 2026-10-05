import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthSession} from '../src/auth.js';

function stub({fail=false,confirmed=true,email='qa@example.test',deferred=false}={}){
  let listener,resolveLogin;const calls=[];
  const user={id:'existing-user',email,email_confirmed_at:confirmed?'2026-10-05':null};
  const session={access_token:'synthetic-only',user};
  const result=()=>{listener?.('SIGNED_IN',session);return fail?{error:new Error('secret upstream')}:{data:{session}};};
  const client={auth:{onAuthStateChange:fn=>(listener=fn,{data:{subscription:{unsubscribe(){}}}}),getSession:async()=>({data:{session}}),getUser:async()=>(calls.push('user'),{data:{user}}),signInWithPassword:async args=>{calls.push(['password',args]);return deferred?new Promise(resolve=>{resolveLogin=()=>resolve(result());}):result();},signOut:async options=>(calls.push(['signout',options]),{}),updateUser:async args=>(calls.push(['update',args]),{})}};
  return {auth:new AuthSession(client),calls,finish:()=>resolveLogin()};
}
test('password authenticates the verified existing identity without publishing SDK intermediate events',async()=>{
  const {auth,calls}=stub();await auth.initialize();const events=[];auth.subscribe(s=>events.push(s));
  const session=await auth.signInWithPassword(' QA@example.test ','synthetic-password');
  assert.equal(session.user.id,'existing-user');assert.equal(events.length,1);
  assert.deepEqual(calls.find(c=>Array.isArray(c)&&c[0]==='password')[1],{email:'qa@example.test',password:'synthetic-password'});
});
test('password failures, unconfirmed users and mismatched identities clear local authorization with sanitized errors',async()=>{
  for(const options of [{fail:true},{confirmed:false},{email:'other@example.test'}]){
    const {auth,calls}=stub(options);await auth.initialize();
    await assert.rejects(()=>auth.signInWithPassword('qa@example.test','synthetic-password'),error=>/邮箱或密码/.test(error.message)&&!error.message.includes('secret'));
    assert.equal(auth.session,null);assert.deepEqual(calls.at(-1),['signout',{scope:'local'}]);
  }
});
test('cancelling a pending successful password request discards its late session',async()=>{
  const {auth,finish,calls}=stub({deferred:true});await auth.initialize();const controller=new AbortController(),events=[];auth.subscribe(s=>events.push(s));
  const pending=auth.signInWithPassword('qa@example.test','synthetic-password',{signal:controller.signal});
  controller.abort();finish();await assert.rejects(()=>pending,/取消/);
  assert.equal(auth.session,null);assert.ok(events.every(s=>s===null));assert.deepEqual(calls.at(-1),['signout',{scope:'local'}]);
});
test('cancellation during identity verification also clears late success',async()=>{
  const {auth,calls}=stub();await auth.initialize();const controller=new AbortController();
  auth.client.auth.getUser=async()=>{controller.abort();return {data:{user:{email:'qa@example.test',email_confirmed_at:'2026-10-05'}}};};
  await assert.rejects(()=>auth.signInWithPassword('qa@example.test','synthetic-password',{signal:controller.signal}),/取消/);
  assert.equal(auth.session,null);assert.deepEqual(calls.at(-1),['signout',{scope:'local'}]);
});
test('password setup requires verified sign-in and updates the same user',async()=>{
  const {auth,calls}=stub();await auth.setPassword('synthetic-long-password');
  assert.deepEqual(calls.at(-1),['update',{password:'synthetic-long-password'}]);
  const unconfirmed=stub({confirmed:false});await assert.rejects(()=>unconfirmed.auth.setPassword('synthetic-long-password'),/先登录/);
  assert.ok(!unconfirmed.calls.some(c=>Array.isArray(c)&&c[0]==='update'));
});
test('concurrent login cannot replace a pending request; cancellation frees the next attempt',async()=>{
  const {auth,finish}=stub({deferred:true});const controller=new AbortController();
  const pending=auth.signInWithPassword('qa@example.test','synthetic-password',{signal:controller.signal});
  await assert.rejects(()=>auth.signInWithPassword('qa@example.test','synthetic-password'),/处理中/);
  controller.abort();finish();await assert.rejects(()=>pending,/取消/);assert.equal(auth.verifying,false);
});
