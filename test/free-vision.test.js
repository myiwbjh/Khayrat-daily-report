import test from 'node:test';
import assert from 'node:assert/strict';
import { visionProvider, requireProviderConsent, GROQ_MODEL } from '../server/vision-provider.js';
import { visionImage, VISION_SCHEMA } from '../server/vision-service.js';
import { ImageAnalysisProvider } from '../src/image-analysis.js';
import { waitForVisionSlot } from '../src/vision-pacing.js';
import configHandler from '../api/config.js';
import visionHandler from '../api/vision.js';

const env = { VISION_PROVIDER: 'groq', GROQ_API_KEY: 'synthetic-server-groq-key',
  GROQ_FREE_TIER_CONFIRMED: 'true', VISION_MODEL: GROQ_MODEL, AI_FEATURES_APPROVED: 'true',
  AI_ALLOWED_USER_EMAILS: 'qa@example.test', SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'public',
  OPENAI_API_KEY: 'synthetic-paid-key', OCR_ENABLED: 'true' };
const result = { scene: '材料堆放', visibleFacts: ['可见模板'], activities: [], equipment: [], materials: ['模板'],
  structures: [], stage: '无法判断', inferences: [], limitations: ['需人工确认'], summary: '可见堆放模板',
  confidence: .5, crossValidation: { status: 'insufficient-evidence', reason: '不能确定具体工序' } };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const completion = content => response({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 3000, completion_tokens: 300, total_tokens: 3300 } });
function sink() { return { code: 200, setHeader(){}, status(code){this.code=code;return this;}, json(value){this.value=value;return this;} }; }
async function withEnv(fn) {
  const oldEnv={...process.env},oldFetch=globalThis.fetch;
  try { Object.assign(process.env, env); await fn(); }
  finally { for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];Object.assign(process.env,oldEnv);globalThis.fetch=oldFetch; }
}

test('free vision fails closed unless plan is confirmed, key exists and model is pinned; paid key cannot be fallback', async () => {
  for(const overrides of [{GROQ_FREE_TIER_CONFIRMED:'false'},{GROQ_API_KEY:''},{VISION_MODEL:'other-model'},{VISION_PROVIDER:'unknown'}]) {
    await assert.rejects(()=>visionImage('', '', VISION_SCHEMA, {env:{...env,...overrides},fetchImpl:()=>{throw Error('must not send');}}),e=>e.status===503);
  }
  assert.equal(visionProvider(env).id,'groq');
  assert.equal(visionProvider(env).minIntervalMs,61000);
});
test('previous OpenAI consent does not authorize Groq transmission, even with owner approval', async () => {
  for(const body of [{consent:true},{consent:true,provider:'openai'}])assert.throws(()=>requireProviderConsent(body,env),e=>e.status===409);
  assert.equal(requireProviderConsent({consent:true,provider:'groq'},env).id,'groq');
  await withEnv(async()=>{
    let called=0;globalThis.fetch=()=>{called++;throw Error('must not send');};const res=sink();
    await visionHandler({method:'POST',body:{consent:true,imageId:'i1'},headers:{authorization:'Bearer token'}},res);
    assert.equal(res.code,409);assert.equal(called,0);
  });
});
test('Groq request uses only fixed endpoint, paired excerpt, server key and JSON mode with validated facts', async () => {
  let sent;
  const out=await visionImage('data:image/png;base64,YQ==','原文'.repeat(1000),VISION_SCHEMA,{env,fetchImpl:async(url,options)=>{
    sent={url,options,body:JSON.parse(options.body)};return completion(result);
  }});
  assert.equal(sent.url,'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(sent.options.headers.Authorization,`Bearer ${env.GROQ_API_KEY}`);
  assert.equal(sent.body.model,GROQ_MODEL);assert.equal(sent.body.reasoning_effort,'none');
  assert.equal(sent.body.max_completion_tokens,900);assert.equal(sent.body.response_format.type,'json_object');
  assert.equal(sent.body.messages[1].content[1].image_url.url,'data:image/png;base64,YQ==');
  assert.ok(sent.body.messages[1].content[0].text.length<1600);
  assert.match(sent.body.messages[0].content,/不能仅因照片没有人员判断停工/);
  assert.match(sent.body.messages[0].content,/JSON Schema/);
  assert.equal(out.provider,'Groq');assert.deepEqual(out.result,result);
  assert.ok(!JSON.stringify(out).includes(env.GROQ_API_KEY));
});
test('free quota exhaustion stops after one request without paid fallback or automatic retry; malformed outputs rejected', async () => {
  let calls=0;
  await assert.rejects(()=>visionImage('', '', VISION_SCHEMA,{env,fetchImpl:async()=>{calls++;return response({error:'do not expose upstream secret'},429);}}),e=>e.status===429&&/未产生付费调用/.test(e.message));
  assert.equal(calls,1);
  for(const invalid of [{...result,confidence:3},{...result,visibleFacts:'invented'},{...result,scene:'停工'},{}])
    await assert.rejects(()=>visionImage('', '', VISION_SCHEMA,{env,fetchImpl:async()=>completion(invalid)}),e=>e.status===502);
});
test('public free configuration exposes destination and limit only, never either API key or allowlist; OCR remains off', async () => {
  await withEnv(async()=>{const res=sink();configHandler({},res);
    assert.equal(res.value.visionEnabled,true);assert.equal(res.value.visionProviderId,'groq');assert.equal(res.value.visionModel,GROQ_MODEL);
    assert.equal(res.value.ocrEnabled,false);assert.equal(res.value.visionMinIntervalMs,61000);
    for(const secret of [env.GROQ_API_KEY,env.OPENAI_API_KEY,env.AI_ALLOWED_USER_EMAILS])assert.ok(!JSON.stringify(res.value).includes(secret));
    process.env.GROQ_FREE_TIER_CONFIRMED='false';const disabled=sink();configHandler({},disabled);assert.equal(disabled.value.visionEnabled,false);
  });
});
test('free API still verifies actual Supabase identity, RLS row and private object before Groq call', async () => {
  await withEnv(async()=>{
    const calls=[];globalThis.fetch=async(url,options)=>{
      calls.push(url);
      if(url.endsWith('/auth/v1/user'))return response({id:'qa',email:'qa@example.test',email_confirmed_at:'2026-01-01'});
      if(url.includes('project_members'))return response([{role:'editor',is_admin:false}]);
      if(url.includes('vision_runs'))return response(options.method==='POST'?[{state:'running'}]:[]);
      if(url.includes('/rest/')){assert.equal(options.headers.Authorization,'Bearer user-token');return response([{payload:{objectPath:'khayrat/batch/i1.png',sourceExcerpt:'唯一配对原文'}}]);}
      if(url.includes('/storage/')){assert.equal(options.headers.Authorization,'Bearer user-token');return new Response('test-pixels',{headers:{'Content-Type':'image/png'}});}
      assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');return completion(result);
    };
    const res=sink();await visionHandler({method:'POST',headers:{authorization:'Bearer user-token'},body:{imageId:'i1',consent:true,provider:'groq',imageDataUrl:'https://evil.test/ignored'}},res);
    assert.equal(res.code,200);assert.equal(calls.length,8);assert.equal(res.value.textFacts,'唯一配对原文');assert.equal(res.value.provider,'Groq');
    calls.length=0;globalThis.fetch=async url=>{calls.push(url);return response({},401);};
    const denied=sink();await visionHandler({method:'POST',headers:{authorization:'Bearer forged'},body:{imageId:'i1',consent:true,provider:'groq'}},denied);
    assert.equal(denied.code,401);assert.equal(calls.length,1);assert.match(calls[0],/auth\/v1\/user/);
  });
});
test('browser binds consent to selected provider and preserves returned provenance; no keys in request', async () => {
  let sent;
  const provider=new ImageAnalysisProvider({endpoint:'/api/vision',consent:true,provider:'groq',accessToken:'user-token',fetchImpl:async(_,options)=>{
    sent=JSON.parse(options.body);return response({...result,provider:'Groq',model:GROQ_MODEL});
  }});
  const out=await provider.analyze({imageId:'i1',objectPath:'khayrat/i1.png',dataUrl:'never send browser pixels'});
  assert.deepEqual(sent,{imageId:'i1',consent:true,provider:'groq'});assert.equal(out.model,GROQ_MODEL);assert.equal(out.manualReviewed,false);
});
test('stop cancels a pending free-rate interval immediately, and no-wait path observes cancellation', async () => {
  const controller=new AbortController(),pending=waitForVisionSlot(61000,controller.signal);controller.abort();
  await assert.rejects(pending,/已停止/);await assert.rejects(()=>waitForVisionSlot(0,controller.signal),/已停止/);
  await waitForVisionSlot(0,new AbortController().signal);
});

