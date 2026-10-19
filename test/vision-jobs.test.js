import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {processVisionJob,workerAuthorized,enqueueVision} from '../server/vision-jobs.js';
const user='00000000-0000-4000-8000-000000000001';
const env={AI_FEATURES_APPROVED:'true',VISION_PROVIDER:'groq',GROQ_API_KEY:'fake',GROQ_FREE_TIER_CONFIRMED:'true',AI_ALLOWED_USER_EMAILS:'qa@example.test',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server-only'};
const consent={consent:true,provider:'groq'},result={scene:'施工中',visibleFacts:['可见钢筋'],activities:[],equipment:[],materials:[],structures:[],stage:'施工',inferences:[],limitations:[],summary:'钢筋施工',confidence:.8,crossValidation:{status:'consistent',reason:'匹配'}};
const analysis={result,provider:'Groq',model:'fixed',analyzedAt:'2026-10-19T00:00:00Z',attempts:[]};

test('durable queue serializes workers, deduplicates enqueue, retains review and denies anonymous/reader writes',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${user}');create table public.project_members(project_id text,user_id uuid,role text);insert into project_members values('khayrat','${user}','editor');create table image_evidence(image_id text primary key,project_id text,payload jsonb,updated_at timestamptz);create table vision_runs(image_id text primary key references image_evidence,project_id text default 'khayrat',state text check(state in ('running','success','failed')),analysis jsonb,attempts jsonb default '[]',updated_at timestamptz default now());alter table vision_runs enable row level security;grant select,insert,update on vision_runs to authenticated;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261019120409_vision_background_queue.sql',import.meta.url),'utf8'));
  for(const id of ['one','two'])await db.query("insert into image_evidence values($1,'khayrat',$2,now())",[id,{objectPath:`khayrat/batch/evidence/${id}.jpg`,relatedDate:'2026-10-19',relatedWorkshop:'中控楼',sourceFile:'original.pdf'}]);
  const enqueue=()=>db.query('select * from enqueue_vision_jobs($1,$2,$3,false)',[['one','two'],user,consent]);
  assert.equal((await enqueue()).rows.length,2);await enqueue();assert.equal((await db.query('select * from vision_runs')).rows.length,2);
  const job=(await db.query('select * from claim_vision_job()')).rows[0];assert.equal(job.state,'running');assert.equal((await db.query('select * from claim_vision_job()')).rows.length,0);
  await db.query("update image_evidence set payload=payload||'{\"manualReviewed\":true,\"caption\":\"human review\",\"scene\":\"材料堆放\"}' where image_id=$1",[job.image_id]);
  const finish=lease=>db.query('select finish_vision_job($1,$2,$3,$4,$5,null) as done',[job.image_id,lease,analysis,{scene:'施工中',visionEnabled:true},'sha256:same']);
  assert.equal((await finish('2020-01-01')).rows[0].done,false);assert.equal((await finish(job.updated_at)).rows[0].done,true);
  const saved=(await db.query('select payload from image_evidence where image_id=$1',[job.image_id])).rows[0].payload;assert.equal(saved.scene,'材料堆放');assert.equal(saved.caption,'human review');assert.equal(saved.relatedDate,'2026-10-19');assert.equal(saved.sourceFile,'original.pdf');assert.equal(saved.automaticAnalysis.scene,'施工中');
  await enqueue();assert.equal((await db.query('select state from vision_runs where image_id=$1',[job.image_id])).rows[0].state,'success');assert.equal((await db.query('select * from claim_vision_job()')).rows.length,0);
  await db.exec("update vision_runs set started_at=now()-interval '2 minutes';");assert.equal((await db.query('select * from claim_vision_job()')).rows.length,1);
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(db.query('select * from claim_vision_job()'),/permission denied/);await assert.rejects(db.query("update vision_runs set state='pending'"),/permission denied/);await assert.rejects(enqueue(),/permission denied/);await db.exec('reset role');}
 }finally{await db.close();}
});

function workerFixture({cached=null,legacy=null,failure=null,revoked=false}={}){
 let modelCalls=0,finish;
 const restImpl=async(path,options)=>{
  if(path.endsWith('/claim_vision_job'))return [{image_id:'new',requested_by:user,consent,updated_at:'lease'}];
  if(path.includes('project_members'))return [{role:revoked?'reader':'editor'}];
  if(path.includes('/auth/'))return {id:user,email:'qa@example.test',email_confirmed_at:'2026-01-01'};
  if(path.includes('content_hash'))return cached?[{analysis:cached}]:[];
  if(path.includes('contentSignature'))return legacy?[{payload:legacy}]:[];
  if(path.endsWith('/finish_vision_job')){finish=JSON.parse(options.body);return true;}
  throw Error('unexpected '+path);
 };
 return {run:()=>processVisionJob({env,restImpl,storedImageImpl:async()=>({dataUrl:'private pixels',contentHash:'sha256:same',context:'new report',evidence:{relatedDate:'2026-10-19'}}),visionImpl:async()=>{modelCalls++;if(failure)throw failure;return analysis;}}),get calls(){return modelCalls;},get finish(){return finish;}};
}
test('new upload is analyzed once, identical hash reuses pixels without reusing report cross-validation',async()=>{
 const first=workerFixture();assert.equal((await first.run()).state,'success');assert.equal(first.calls,1);assert.equal(first.finish.p_hash,'sha256:same');assert.equal(first.finish.p_evidence.textFacts,'new report');
 const duplicate=workerFixture({cached:first.finish.p_analysis});assert.equal((await duplicate.run()).cached,true);assert.equal(duplicate.calls,0);assert.equal(duplicate.finish.p_evidence.crossValidation.status,'insufficient-evidence');
});
test('legacy recognition is reused; provider failures and revoked permission persist a visible failure',async()=>{
 const legacy=workerFixture({legacy:{...result,visionEnabled:true,provider:'Groq',model:'legacy'}});await legacy.run();assert.equal(legacy.calls,0);
 const failed=workerFixture({failure:Object.assign(Error('所有免费服务不可用'),{status:429})});assert.equal((await failed.run()).state,'failed');assert.equal(failed.calls,1);assert.match(failed.finish.p_error,/免费/);
 const revoked=workerFixture({revoked:true});await revoked.run();assert.equal(revoked.calls,0);assert.match(revoked.finish.p_error,/授权/);
});
test('worker requires a dedicated secret; enqueue validates consent, IDs and never accepts paid models',async()=>{
 assert.equal(workerAuthorized({headers:{}},{}),false);assert.equal(workerAuthorized({headers:{authorization:'Bearer '+'x'.repeat(32)}},{VISION_WORKER_SECRET:'y'.repeat(32)}),false);assert.equal(workerAuthorized({headers:{authorization:'Bearer '+'x'.repeat(32)}},{VISION_WORKER_SECRET:'x'.repeat(32)}),true);
 await assert.rejects(()=>enqueueVision({...consent,imageIds:'bad'},{user:{id:user}},{env}),e=>e.status===400);
 await assert.rejects(()=>enqueueVision({imageId:'a',provider:'groq'},{user:{id:user}},{env}),e=>e.status===403);
});
