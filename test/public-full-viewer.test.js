import test from 'node:test';import assert from 'node:assert/strict';
import {publicProjection} from '../server/public-dashboard.js';
import {summarizeProgress} from '../src/project-data.js';
import publicHandler from '../api/public-dashboard.js';
import {currentPublicDashboard} from '../api/public-dashboard.js';
import {readActivePublicProgress} from '../server/public-source.js';
import {latestValidPhotoSelection} from '../src/latest-gallery.js';
import {summarizeProgressWithWeekly} from '../src/project-data.js';
import {readFile} from 'node:fs/promises';
import {parseKhayratProgressWorkbook} from '../src/xlsx.js';

test('public refresh preserves reviewed actual basis and latest weekly cumulative without review metadata',async()=>{
 const file=await readFile(new URL('./fixtures/Khayrat-progress-real.xlsx',import.meta.url)),parsed=await parseKhayratProgressWorkbook(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'private.xlsx');
 const decisions=[['1.2',6000],['1.3',800]].map(([wbs,correctedValue])=>({issueId:`plan-tracking-quantity:${wbs}`,action:'adopt-correction',correctedValue,note:'private-review-note',reviewedBy:'private-user'}));
 const restImpl=async path=>path.includes('progress_import_batches')?[{id:parsed.batch.id,metadata:{reviewDecisions:decisions},quality_status:'Verified'}]:parsed.currentRecords.map(payload=>({payload}));
 const progress=await readActivePublicProgress({restImpl}),reports=[{recordType:'weekly-quantity',sourceType:'weekly-report',date:'2026-10-18',periodStart:'2026-10-12',periodEnd:'2026-10-18',workshop:'项目',process:'混凝土',workCategory:'混凝土',workUnit:'m³',weeklyQuantity:100,weeklyCumulativeQuantity:3000,plannedTotalQuantity:6000}],asOf='2026-10-19';
 const member=summarizeProgressWithWeekly({reports,progress,asOf}),output=publicProjection(reports,progress,[],{asOf}),anonymous=summarizeProgressWithWeekly({reports:output.reports,progress:output.progressRecords,asOf});
 assert.equal(output.progressRecords.length,parsed.currentRecords.length);assert.deepEqual(anonymous.timeline,member.timeline);assert.equal(anonymous.actual,member.actual);assert.equal(anonymous.actualAsOf,'2026-10-18');assert.ok(anonymous.timeline.some(p=>p.actualSource==='weekly-report'));
 const refreshed=publicProjection(reports,await readActivePublicProgress({restImpl}),[],{asOf});assert.deepEqual(refreshed.progressRecords,output.progressRecords);assert.deepEqual(refreshed.progress.timeline,output.progress.timeline);
 for(const privateField of ['private-review-note','private-user','reviewDecisions','workbookMeta','private.xlsx'])assert.ok(!JSON.stringify(output).includes(privateField));
});
test('full public output allowlists all business domains and preserves WBS selection',()=>{
 const secret={sourceFile:'private.pdf',originalObjectPath:'private/path',fileHash:'secret-hash',rawRecord:'private-excerpt',user_id:'private-user',apiKey:'secret',provenance:{excerpt:'private-excerpt'}};
 const reports=[{...secret,date:'2026-10-01',workshop:'A',process:'钢筋',constructionContent:'施工',risk:'公开快照不应出现此风险原文',staffScope:'项目总人数',chineseStaff:70,localStaff:23,personnelStatistics:{...secret,scope:'project',timeBasis:'current',issues:['待核']}}];
 const progress=[{...secret,wbs:'A',month:'2026-09-30',weight:100,actualCumulativePct:40,plannedCumulativePct:50,sourceType:'progress-workbook',snapshotRole:'current',importBatchId:'private-batch',importedAt:'2026-10-01',quantityMismatch:true,baselineTotal:100,trackingTotal:80}];
 const output=publicProjection(reports,progress,[],{asOf:'2026-10-07',shipments:[{...secret,equipmentName:'磨机',status:'现场到货'}],mappings:[{...secret,sourceType:'workshop',sourceValue:'A',targetType:'wbs',targetValue:'A',relation:'related'}],milestones:[{...secret,id:'m1',name:'设备安装',date:'2026-12-01',datePrecision:'month'}]});
 assert.equal(output.schemaVersion,4);assert.equal(output.reports[0].constructionContent,'施工');assert.equal(output.shipments[0].equipmentName,'磨机');assert.equal(output.mappings[0].targetValue,'A');assert.equal(output.milestones[0].name,'设备安装');assert.deepEqual(output.reports[0].personnelStatistics.issues,['待核']);assert.equal(output.progress.decisionReady,false);assert.ok(output.validUntil);
 const summary=summarizeProgress(output.progressRecords,{asOf:'2026-10-07'});assert.equal(summary.actual,40);assert.equal(summary.planned,50);assert.equal(summary.qualityIssues.length,1);
 for(const word of ['private','secret','provenance','originalObjectPath','sourceFile','apiKey','supplier','packageLot','公开快照不应出现此风险原文'])assert.ok(!JSON.stringify(output).includes(word),word);
});
test('public dashboard rejects mutation before database access',async()=>{const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};await publicHandler({method:'POST'},response);assert.equal(response.code,405);});

test('incomplete and explicitly excluded reports never enter the public snapshot',()=>{const p=publicProjection([{date:'',constructionContent:'待核施工记录',needsReview:true,reviewFields:['date']},{date:'2026-10-01',workshop:'A',process:'施工',constructionContent:'旧占位',publicationEligible:false},{date:'2026-10-01',workshop:'A',process:'施工',constructionContent:'可公开'}],[],[]);assert.equal(p.reports.length,1);assert.equal(p.reports[0].constructionContent,'可公开');assert.equal(p.workshops.length,1);});

test('public dashboard uses the live current version after publication authorization',async()=>{const calls=[],restImpl=async path=>{calls.push(path);if(path.includes('public_dashboard_snapshots'))return [{published_at:'2026-10-01T00:00:00Z'}];if(path.includes('daily_reports'))return path.includes('offset=0')?[{payload:{date:'2026-10-13',workshop:'A',process:'施工',constructionContent:'最新'}}]:[];if(path.includes('progress_import_batches'))return [{id:'active-test-batch'}];if(path.includes('progress_measurements'))return [{payload:{wbs:'1',month:'2026-10-31',weight:1,plannedCumulativePct:20,actualCumulativePct:10}}];if(path.includes('project_milestones'))return [];return [];};const output=await currentPublicDashboard({restImpl,now:new Date('2026-10-17T00:00:00Z')});assert.equal(output.published,true);assert.equal(output.authorizedAt,'2026-10-01T00:00:00Z');assert.equal(output.syncedAt,'2026-10-17T00:00:00.000Z');assert.equal(output.asOf,'2026-10-13');assert.equal(output.reports[0].constructionContent,'最新');assert.ok(calls.some(path=>path.includes('current_version=eq.true')));});

test('public progress only queries the completed active batch, never superseded or failed imports',async()=>{
 const calls=[],restImpl=async path=>{calls.push(path);
  if(path.includes('/progress_import_batches?'))return [{id:'progress:khayrat:active'}];
  if(path.includes('/progress_measurements?'))return [{payload:{wbs:'A',weight:100,actualCumulativePct:42}}];
  return [];
 };
 const progress=await readActivePublicProgress({restImpl});
 assert.equal(progress.length,1);
 assert.equal(progress[0].actualCumulativePct,42);
 assert.ok(calls.some(path=>path.includes('import_status=eq.complete')&&path.includes('current_version=eq.true')));
 assert.ok(calls.some(path=>path.includes('import_batch_id=eq.progress%3Akhayrat%3Aactive')&&path.includes('current_version=eq.true')));
});
test('public progress fails closed if no completed active batch exists or activation is ambiguous',async()=>{
 let measurementsQueried=false;
 const empty=await readActivePublicProgress({restImpl:async path=>{if(path.includes('progress_measurements'))measurementsQueried=true;return [];}});
 assert.deepEqual(empty,[]);assert.equal(measurementsQueried,false);
 await assert.rejects(readActivePublicProgress({restImpl:async()=>[{id:'one'},{id:'two'}]}),/Ambiguous active/);
});
test('latest report photo selection never falls back to an older photo date',()=>{
 const {date,photos}=latestValidPhotoSelection([
  {imageId:'construction',relatedDate:'2026-10-14'},
  {imageId:'logo',relatedDate:'2026-10-16',logoConfirmed:true},
  {imageId:'header',relatedDate:'2026-10-17',decorative:true},
  {imageId:'ignored',relatedDate:'2026-10-18',ignored:true},
 ],'2026-10-17');
 assert.equal(date,'2026-10-17');assert.deepEqual(photos,[]);
 assert.deepEqual(latestValidPhotoSelection([{imageId:'construction',relatedDate:'2026-10-14'}],''),{date:'2026-10-14',photos:[{imageId:'construction',relatedDate:'2026-10-14'}]});
});

test('public photos are complete, deterministic and newest first',()=>{
 const base={publicApproved:true,manualReviewed:true,relatedRecordId:'report',scene:'施工中'};
 const photos=publicProjection([],[],[
  {...base,imageId:'older',relatedDate:'2026-10-06',relatedWorkshop:'水泥库'},
  {...base,imageId:'latest-b',relatedDate:'2026-10-07',relatedWorkshop:'水泥磨'},
  {...base,imageId:'latest-a',relatedDate:'2026-10-07',relatedWorkshop:'中控楼'},
 ],{asOf:'2026-10-07'}).photos;
 assert.deepEqual(photos.map(photo=>photo.imageId),['latest-a','latest-b','older']);
});

