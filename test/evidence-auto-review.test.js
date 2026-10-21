import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewImageEvidence,substantiveConflict} from '../src/evidence-auto-review.js';
import {evidenceStatus,evidenceStatusCounts} from '../src/evidence-status.js';
import {evidenceReviewState} from '../src/image-analysis.js';
import {reviewEvidence} from '../server/evidence-review.js';
import {publicPhotoProjection} from '../server/public-dashboard.js';
import handler from '../api/evidence-review.js';

const photo={imageId:'photo',sourceFile:'daily.pdf',originalObjectPath:'private/daily.pdf',pageNumber:2,bbox:{x:20,y:30,width:20,height:20},relatedDate:'2026-10-18',relatedWorkshop:'中控室',relatedRecordId:'obsolete-link',association:{blockId:'b1',needsReview:true},visionEnabled:true,provider:'Groq',scene:'施工中',visibleFacts:['基础钢筋已绑扎，支模施工'],activities:['钢筋施工'],inferences:[],crossValidation:{status:'insufficient-evidence'}};
function context(original='中控楼基础钢筋绑扎、模板安装施工进行中'){
  const row={id:'daily-r',sourceFile:photo.sourceFile,originalObjectPath:photo.originalObjectPath,sourceType:'daily-report',date:photo.relatedDate,workshop:'中控楼',pageNumber:2,sourceExcerpt:original,constructionContent:original};
  return {records:[row,{...row,id:'summary',recordType:'personnel-summary',workshop:'全项目',documentLayout:[{pageNumber:1,text:'施工日报\n报告日期：2026年10月18日'},{pageNumber:2,text:original,blocks:[{id:'b1',workshop:'中控楼',excerpt:original,region:{x:0,y:0,width:100,height:100}}]}]}],mappings:[]};
}

test('source geometry, alias and semantic activities clear a generic association flag without changing originals',()=>{
  const data=context(),before=JSON.stringify({photo,data}),r=reviewImageEvidence(photo,data);
  assert.equal(r.status,'passed');assert.equal(r.confirmedWorkshop,'中控楼');assert.equal(r.resolvedRecordId,'daily-r');
  assert.ok(r.basis.some(b=>b.kind==='daily-section'&&b.pageNumber===2&&b.blockId==='b1'));
  assert.equal(evidenceStatus({...photo,automaticReview:r}),'recognized');assert.equal(evidenceReviewState({...photo,automaticReview:r}).label,'核对通过');
  assert.equal(JSON.stringify({photo,data}),before);
});
test('report date outranks linked metadata and malformed dates never throw',()=>{
  const data=context();data.records[1].documentLayout[0].text='施工日报\n报告日期：2026年10月17日';
  assert.equal(reviewImageEvidence(photo,data).code,'date-conflict');
  for(const relatedDate of ['2026-99-01','2026-02-30',''])assert.equal(reviewImageEvidence({...photo,relatedDate},context()).code,'date-uncertain');
  data.records[1].documentLayout[0].text='施工日报，日期待补';assert.equal(reviewImageEvidence(photo,data).code,'date-uncertain');
});
test('explicit distinct workshop mapping and source workshop conflicts are retained',()=>{
  const data=context();data.mappings=[{sourceType:'workshop_alias',sourceValue:'中控室',targetType:'workshop',targetValue:'中控楼',relation:'distinct'}];
  assert.equal(reviewImageEvidence(photo,data).code,'workshop-conflict');
  assert.equal(reviewImageEvidence({...photo,relatedWorkshop:'水泥磨'},context()).code,'workshop-conflict');
});
test('missing source and ambiguous whole-page workshop remain manual with photo location',()=>{
  assert.equal(reviewImageEvidence(photo).code,'source-missing');
  const data=context();delete data.records[1].documentLayout[1].blocks;
  const r=reviewImageEvidence({...photo,nearbyText:'中控楼、水泥磨等车间施工'},data);
  assert.equal(r.code,'workshop-uncertain');assert.equal(r.basis[0].pageNumber,2);
});
test('explicit opposite facts about the same component are retained; invisible or different objects are not conflicts',()=>{
  const r=reviewImageEvidence({...photo,visibleFacts:['基础已完成浇筑'],activities:[]},context('中控楼基础尚未浇筑'));
  assert.equal(r.code,'fact-conflict');assert.match(r.conflict.original,/尚未/);
  assert.equal(substantiveConflict('基础已完成浇筑',['照片未见基础浇筑']),null);
  assert.equal(substantiveConflict('1号库基础未浇筑',['2号库基础已完成浇筑']),null);
  assert.equal(substantiveConflict('基础未浇筑',['基础未浇筑完成']),null);
  assert.ok(substantiveConflict('基础已完成浇筑',['基础未浇筑']));
});
test('minor wording/visibility differences clear only with positive activity corroboration',()=>{
  const weak={...photo,crossValidation:{status:'potential-conflict',reason:'视角局部，照片未涵盖全部模板'},visibleFacts:['可见基础钢筋'],activities:[]};
  assert.equal(reviewImageEvidence(weak,context()).status,'passed');
  assert.equal(reviewImageEvidence({...weak,visibleFacts:['未见钢筋和模板']},context()).code,'visual-insufficient');
  assert.equal(reviewImageEvidence({...weak,crossValidation:{status:'potential-conflict',reason:'基础实际完成状态与原文相反'}},context()).code,'fact-conflict');
});
test('manual decisions including unresolved are never re-decided automatically',()=>{
  for(const decision of ['calibrated','acceptable','confirmed-conflict','unresolved'])assert.equal(reviewImageEvidence({...photo,calibration:{decision}},context()),null);
  assert.equal(reviewImageEvidence({...photo,manualReviewed:true,manualReview:{confirmed:true}},context()),null);
  assert.equal(evidenceStatus({...photo,automaticReview:{status:'passed'},calibration:{decision:'unresolved'}}),'review');
});
function weekly(){
  const image={...photo,sourceType:'weekly-report',sourceFile:'weekly.pptx',originalObjectPath:'private/weekly.pptx',comparisonPeriod:'本周'};
  const base={sourceFile:image.sourceFile,originalObjectPath:image.originalObjectPath,sourceType:'weekly-report',date:image.relatedDate,periodStart:'2026-10-12',periodEnd:'2026-10-18'};
  const records=[{...base,id:'weekly-doc',recordType:'weekly-document',pages:[{pageNumber:2,text:'中控楼 本周'}]},{...base,id:'weekly-r',recordType:'weekly-workshop-status',workshop:'中控楼',sourceExcerpt:'基础钢筋绑扎施工中',nextWeekPlan:'基础混凝土浇筑完成',pageNumber:4}];
  return {image,records};
}
test('weekly title aliases corroborate current-period work, never last-week dates or next-week plans',()=>{
  const {image,records}=weekly();
  assert.equal(reviewImageEvidence(image,{records}).status,'passed');
  assert.equal(reviewImageEvidence({...image,comparisonPeriod:'上周'},{records}),null); // Historical comparisons are excluded before review.
  assert.equal(reviewImageEvidence({...image,comparisonPeriod:''},{records}).code,'date-uncertain');
  assert.equal(reviewImageEvidence({...image,visibleFacts:['基础混凝土已浇筑'],activities:[]},{records}).code,'visual-insufficient');
  records.pop();assert.equal(reviewImageEvidence(image,{records}).code,'source-insufficient');
});
test('same-period weekly text is supporting evidence, without overriding the daily source',()=>{
  const data=context(),week=weekly();data.records.push(week.records[1]);
  const r=reviewImageEvidence(photo,data);assert.equal(r.status,'passed');assert.equal(r.basis.find(b=>b.kind==='weekly-support').sourceFile,'weekly.pptx');
});
function repository({count=1,concurrent=false}={}){
  const rows=Array.from({length:count},(_,i)=>({image_id:`i-${i}`,payload:{...photo,imageId:`i-${i}`},updated_at:'2026-10-19T00:00:00Z'})),calls=[];
  const restImpl=async(path,options={})=>{
    const u=new URL(path,'https://test'),table=u.pathname.split('/').at(-1);calls.push({path,method:options.method||'GET'});
    if(options.method==='PATCH'){
      const row=rows.find(r=>`eq.${r.image_id}`===u.searchParams.get('image_id'));
      if(concurrent||`eq.${row.updated_at}`!==u.searchParams.get('updated_at'))return [];
      Object.assign(row,JSON.parse(options.body));return [row];
    }
    const all=table==='image_evidence'?rows:table==='daily_reports'?context().records.map(payload=>({payload})):[],offset=Number(u.searchParams.get('offset'));
    return structuredClone(all.slice(offset,offset+500));
  };
  return {rows,calls,restImpl};
}
test('server persists only derived review, caches identical inputs, and appends history after source facts change',async()=>{
  const db=repository(),original=structuredClone(db.rows[0].payload),first=await reviewEvidence({restImpl:db.restImpl});
  assert.equal(first.passed,1);assert.deepEqual(db.rows[0].payload.automaticReviewHistory,[]);
  const {automaticReview,automaticReviewHistory,...unchanged}=db.rows[0].payload;assert.deepEqual(unchanged,original);
  const second=await reviewEvidence({restImpl:db.restImpl});assert.equal(second.updated,0);assert.equal(second.unchanged,1);
  db.rows[0].payload.visibleFacts=['无法辨识照片'];db.rows[0].payload.activities=[];
  const changed=await reviewEvidence({restImpl:db.restImpl});assert.equal(changed.pending,1);
  assert.deepEqual(db.rows[0].payload.automaticReviewHistory,[automaticReview]);
});
test('all-page review counts and batched writes are independent of gallery pagination; CAS avoids overwriting concurrent edits',async()=>{
  const db=repository({count:525}),summary=await reviewEvidence({restImpl:db.restImpl,limit:100});
  assert.equal(summary.checked,525);assert.equal(summary.passed,100);assert.equal(summary.deferred,425);
  assert.equal(evidenceStatusCounts(db.rows.map(r=>r.payload)).review,425);
  const collision=repository({concurrent:true}),result=await reviewEvidence({restImpl:collision.restImpl});
  assert.equal(result.concurrent,1);assert.equal(collision.rows[0].payload.automaticReview,undefined);
});
test('published status matches authenticated status but private review basis and history are not disclosed',()=>{
  const p={...photo,publicApproved:true,manualReviewed:true,automaticReview:{...reviewImageEvidence(photo,context()),inputHash:'private hash'},automaticReviewHistory:[{secret:'private audit'}]};
  const [publicImage]=publicPhotoProjection([p],{asOf:'2026-10-20'});
  assert.equal(publicImage.evidenceStatus,evidenceStatus(p));assert.equal(publicImage.automaticReview.status,'passed');
  assert.doesNotMatch(JSON.stringify(publicImage),/private hash|private audit|daily\.pdf|sourceFile|basis|inputHash|History/);
});
test('review endpoint rejects anonymous, Reader and invalid IDs before any service write',async t=>{
  const previous={...process.env};process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_ANON_KEY='public';process.env.SUPABASE_SERVICE_ROLE_KEY='server-only';
  let role='reader',writes=0;
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    if(options.method==='PATCH')writes++;
    return {ok:true,status:200,json:async()=>String(url).endsWith('/auth/v1/user')?{id:'u',email_confirmed_at:'2026-10-01'}:String(url).includes('project_members')?[{role}]:[]};
  });
  const invoke=async(headers={},body={},method='POST')=>{const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};await handler({method,headers,body},res);return res;};
  try{
    assert.equal((await invoke()).code,401);assert.equal((await invoke({authorization:'Bearer token'})).code,403);
    role='editor';assert.equal((await invoke({authorization:'Bearer token'},{imageIds:['bad)']})).code,400);
    assert.equal((await invoke({authorization:'Bearer token'})).code,200);assert.equal((await invoke({},{} ,'GET')).code,405);
    assert.equal(writes,0);
  }finally{for(const key of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
