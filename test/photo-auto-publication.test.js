import test from 'node:test';
import assert from 'node:assert/strict';
import {publicPhotoAllowed,publicProjection} from '../server/public-dashboard.js';
import {currentPublicDashboard} from '../api/public-dashboard.js';
import photoHandler from '../api/public-photo.js';
import {readPublicSource} from '../server/public-source.js';
import {latestValidPhotoSelection} from '../src/latest-gallery.js';

const report={id:'report-new',date:'2026-10-14',workshop:'中控楼',process:'施工'};
const photo=()=>({created_at:'2026-10-18T15:00:00Z',report_id:report.id,payload:{imageId:'new-photo',relatedDate:report.date,relatedRecordId:report.id,relatedWorkshop:report.workshop,scene:'施工中',visionEnabled:true,provider:'vision',analyzedAt:'2026-10-18T15:01:00Z',aiSummary:'可见施工',visibleFacts:['可见钢筋'],objectPath:'khayrat/import/evidence/new-photo.png',manualReviewed:false}});

test('prospective photo authorization preserves recognition and manual review, and fails closed',()=>{
  const row=photo(),before=structuredClone(row);
  assert.equal(publicPhotoAllowed(row,{reports:[report]}),true);
  for(const patch of [{publicApproved:false},{visionEnabled:false},{provider:'text-only'},{analysisError:'timeout'},{analysisStatus:'running'},{aiSummary:''},{visibleFacts:[]},{analyzedAt:''},{ignored:true},{decorative:true},{logoConfirmed:true},{scene:'无法判断'},{relatedRecordId:'missing'},{relatedDate:'2026-10-13'},{sourceType:'weekly-report'}])assert.equal(publicPhotoAllowed({...row,payload:{...row.payload,...patch}},{reports:[report]}),false,JSON.stringify(patch));
  assert.equal(publicPhotoAllowed({...row,created_at:'2026-10-18T14:00:00Z'},{reports:[report]}),false);
  assert.equal(publicPhotoAllowed(row),false);
  assert.equal(publicPhotoAllowed(row,{reports:[{...report,publicationEligible:false}]}),false);
  const output=publicProjection([report],[],[row],{asOf:report.date});
  assert.equal(output.photos.length,1);assert.equal(output.photos[0].manualReviewed,false);
  assert.equal(output.photos[0].aiSummary,row.payload.aiSummary);
  assert.deepEqual(row,before);assert.ok(!JSON.stringify(output).includes('objectPath'));
});

test('recognition completion and later edits sync without publishing or AI writes; latest overview never falls back',async()=>{
  const row=photo();row.payload.visionEnabled=false;
  const reports=[report],calls=[];
  const restImpl=async path=>{calls.push(path);if(path.includes('public_dashboard_snapshots'))return [{published_at:'2026-10-18'}];if(path.includes('daily_reports'))return reports.map(payload=>({payload}));if(path.includes('image_evidence'))return [row];return [];};
  const options={restImpl,now:new Date('2026-10-20T00:00:00Z')};
  assert.equal((await currentPublicDashboard(options)).photos.length,0);
  row.payload.visionEnabled=true;assert.equal((await currentPublicDashboard(options)).photos.length,1);
  row.payload.aiSummary='识别结果更新';assert.equal((await currentPublicDashboard(options)).photos[0].aiSummary,'识别结果更新');
  reports.push({...report,id:'next',date:'2026-10-15'});
  const output=await currentPublicDashboard(options);
  assert.equal(output.asOf,'2026-10-15');assert.equal(output.photos.length,1);
  assert.equal(latestValidPhotoSelection(output.photos.map(p=>({...p,relatedDate:p.date})),output.asOf).photos.length,0);
  row.payload.publicApproved=false;assert.equal((await currentPublicDashboard(options)).photos.length,0);
  assert.ok(calls.some(path=>path.includes('created_at.gt.')&&path.includes('publicApproved.eq.true')));
});

test('public source retains trusted creation time and reads every image page',async()=>{
  const calls=[],rows=Array.from({length:501},(_,i)=>({...photo(),payload:{...photo().payload,imageId:`photo-${i}`}}));
  const source=await readPublicSource({restImpl:async path=>{calls.push(path);if(!path.includes('image_evidence'))return [];const offset=Number(new URL(path,'https://test').searchParams.get('offset'));return rows.slice(offset,offset+500);}});
  assert.equal(source.images.length,501);assert.equal(source.images[500].created_at,rows[500].created_at);
  assert.ok(calls.some(path=>path.includes('offset=500')));
});

test('anonymous original and thumbnail enforce the same prospective grant and explicit veto',async()=>{
  const row=photo(),savedFetch=global.fetch,savedEnv={...process.env};let storageReads=0;
  const {default:sharp}=await import('sharp'),png=await sharp({create:{width:2,height:2,channels:3,background:'#ffffff'}}).png().toBuffer();
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
  global.fetch=async url=>{const path=new URL(url).pathname;if(path.includes('/storage/')){storageReads++;return new Response(png,{headers:{'content-type':'image/png'}});}return Response.json(path.includes('public_dashboard_snapshots')?[{project_id:'khayrat'}]:path.includes('image_evidence')?[row]:path.includes('daily_reports')?[{payload:report}]:[]);};
  const response=()=>({setHeader(){},status(code){this.code=code;return this;},end(){return this;},send(body){this.body=body;return this;}});
  try{
    for(const thumb of [undefined,'1']){const res=response();await photoHandler({method:'GET',query:{id:'new-photo',thumb}},res);assert.equal(res.code,200);assert.ok(res.body.length);}
    row.payload.publicApproved=false;const res=response();await photoHandler({method:'GET',query:{id:'new-photo'}},res);assert.equal(res.code,404);assert.equal(storageReads,2);
    const write=response();await photoHandler({method:'POST',query:{id:'new-photo'}},write);assert.equal(write.code,405);
  }finally{global.fetch=savedFetch;for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']){if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];}}
});
