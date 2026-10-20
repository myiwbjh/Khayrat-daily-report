import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceStatus,evidenceStatusCounts,canRecognizeEvidence} from '../src/evidence-status.js';
import {evidenceReviewState} from '../src/image-analysis.js';
import {publicPhotoProjection} from '../server/public-dashboard.js';
import {EvidenceStore} from '../src/storage.js';
import {SupabaseCloudRepository} from '../src/cloud.js';
const photo={imageId:'i',visionEnabled:true,provider:'Groq',scene:'施工中',visibleFacts:['模板'],inferences:[],relatedDate:'2026-10-18',relatedWorkshop:'中控楼',relatedRecordId:'r',objectPath:'private/path',crossValidation:{status:'consistent'}};

test('valid stored results win over stale failed job state; metadata/manual review alone is not AI',()=>{
  assert.equal(evidenceStatus({...photo,analysisStatus:'failed'}),'recognized');
  for(const extra of [{visionEnabled:false},{visibleFacts:null},{scene:'invalid'},{provider:'text-only'}])assert.equal(evidenceStatus({...photo,...extra}),'unrecognized');
  assert.equal(evidenceStatus({...photo,visionEnabled:false,manualReviewed:true,calibration:{decision:'acceptable'}}),'unrecognized');
  assert.equal(evidenceStatus({...photo,visionEnabled:false,automaticAnalysis:photo}),'recognized');
});
test('date, workshop, content and association anomalies require review; weak visual evidence alone does not',()=>{
  for(const extra of [{relatedDate:''},{relatedWorkshop:''},{relatedRecordId:''},{association:{needsReview:true}},{association:{status:'ambiguous'}},{dateAssociation:{needsReview:true}},{reviewFields:['date']},{crossValidation:{status:'potential-conflict'}}])assert.equal(evidenceStatus({...photo,...extra}),'review');
  assert.equal(evidenceStatus({...photo,reviewRecommended:true,crossValidation:{status:'insufficient-evidence'}}),'recognized');
});
test('completed calibrations leave the review queue without suppressing confirmed risk or changing history',()=>{
  const original={...photo,association:{needsReview:true},crossValidation:{status:'potential-conflict'},initialAnalysis:{...photo},calibrationHistory:[{decision:'unresolved'}]};
  for(const decision of ['calibrated','acceptable','confirmed-conflict'])assert.equal(evidenceStatus({...original,calibration:{decision}}),'recognized');
  const confirmed={...original,calibration:{decision:'confirmed-conflict'}};
  assert.equal(evidenceReviewState(confirmed).alert,true);
  assert.equal(evidenceStatus({...original,calibration:{decision:'unresolved'}}),'review');
  assert.equal(evidenceStatus({...original,manualReviewed:true,manualReview:{confirmed:true}}),'recognized');
  assert.equal(evidenceStatus({...original,manualReviewed:true}),'review');
  assert.deepEqual(original.calibrationHistory,[{decision:'unresolved'}]);
});
test('counts cover the full collection; retries exclude valid results, ignored photos and in-flight work',()=>{
  const photos=[...Array.from({length:525},()=>photo),{...photo,visionEnabled:false,analysisStatus:'failed'}, {...photo,association:{needsReview:true}}, {...photo,ignored:true}, {...photo,decorative:true}];
  assert.deepEqual(evidenceStatusCounts(photos),{all:528,unrecognized:1,review:1,recognized:525,excluded:1,failed:1});
  for(const state of ['pending','running'])assert.equal(canRecognizeEvidence({...photo,visionEnabled:false,analysisStatus:state}),false);
  assert.equal(canRecognizeEvidence({...photo,visionEnabled:false,analysisStatus:'failed'}),true);
  assert.equal(canRecognizeEvidence(photo),false);
});
test('public status equals member status without exposing calibration notes, users or storage paths',()=>{
  const source={...photo,publicApproved:true,manualReviewed:true,calibration:{decision:'acceptable',note:'private note',operatorId:'private user'}};
  const [projected]=publicPhotoProjection([source],{asOf:'2026-10-20'});
  assert.equal(projected.evidenceStatus,evidenceStatus(source));
  assert.deepEqual(projected.reviewState,evidenceReviewState(source));
  const publicImage={association:{status:'published'},publicEvidenceStatus:projected.evidenceStatus};
  assert.equal(evidenceStatus(publicImage),'recognized');
  assert.doesNotMatch(JSON.stringify(projected),/private note|private user|private\/path|operatorId|calibration/);
});
test('authoritative refresh removes vanished cloud rows and stale fields, preserving unsaved work and local image bytes',()=>{
  const store=new EvidenceStore({getItem:()=>null,setItem:()=>{}});
  store.setCache([{...photo,dataUrl:'local bytes',calibration:{decision:'acceptable'}},{imageId:'gone'},{imageId:'unsaved',cloudSyncPending:true}]);
  store.mergeRemote([{...photo,association:{needsReview:true}}],{authoritative:true});
  assert.deepEqual(store.all().map(i=>i.imageId),['i','unsaved']);
  assert.equal(store.all()[0].dataUrl,'local bytes');
  assert.equal(store.all()[0].calibration,undefined);
  assert.equal(evidenceStatus(store.all()[0]),'review');
});
test('cloud status reads all Supabase pages, independently of gallery pagination',async()=>{
  const requests=[],repo=new SupabaseCloudRepository({supabaseUrl:'https://db.example',supabaseAnonKey:'anon'},{accessToken:'jwt',fetchImpl:async url=>{requests.push(url);const u=new URL(url),offset=Number(u.searchParams.get('offset'));return {ok:true,json:async()=>u.pathname.endsWith('image_evidence')?Array.from({length:offset===0?500:25},(_,n)=>({payload:{...photo,imageId:`i${offset+n}`}})):[{image_id:'i524',state:'failed',error:'quota'}]};}});
  const rows=await repo.loadVisionEvidence();assert.equal(rows.length,525);assert.equal(rows.at(-1).analysisStatus,'failed');assert.equal(rows.at(-1).analysisError,'quota');assert.equal(requests.filter(url=>url.includes('image_evidence')).length,2);
});
