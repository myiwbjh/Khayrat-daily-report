import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/photo-fingerprint-backfill.js';

test('photo fingerprint backfill is editor-only and rejects mutation-free methods',async t=>{
  const previous={...process.env};process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_ANON_KEY='public';process.env.SUPABASE_SERVICE_ROLE_KEY='server-only';let role='reader',storageReads=0;
  t.mock.method(globalThis,'fetch',async(url)=>{if(String(url).includes('/storage/'))storageReads++;return {ok:true,status:200,json:async()=>String(url).endsWith('/auth/v1/user')?{id:'u',email_confirmed_at:'2026-10-01'}:String(url).includes('project_members')?[{role}]:[]};});
  const invoke=async(headers={},method='POST')=>{const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({method,headers,body:{limit:1}},res);return res;};
  try{assert.equal((await invoke()).code,401);assert.equal((await invoke({authorization:'Bearer token'})).code,403);role='editor';assert.equal((await invoke({},'GET')).code,405);assert.equal(storageReads,0);}
  finally{for(const key of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
