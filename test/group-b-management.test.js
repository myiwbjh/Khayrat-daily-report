import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseKhayratProgressWorkbook} from '../src/xlsx.js';
import {summarizeProgressWithWeekly} from '../src/project-data.js';
import {renderProgressChart} from '../src/progress-chart.js';
import {analyzeCriticalPath} from '../src/critical-path.js';

const wbs=['1','2','3','4'].map(id=>({projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',
  batchCurrentVersion:true,batchImportStatus:'complete',importBatchId:'test-group-b',
  wbs:id,item:'活动'+id,isLeaf:true,month:'2026-09-30',weight:25,
  plannedCumulativePct:20,actualCumulativePct:20}));
const map=(sourceType,sourceValue,targetType,targetValue,relation)=>({sourceType,sourceValue,targetType,targetValue,relation});
const network=[
 ...[['1',2],['2',5],['3',3],['4',1]].map(([id,days])=>map('wbs_duration',id,'duration_days',String(days),'calendar-days')),
 map('wbs_start','1','role','start','project-start'),
 ...[['2','1'],['3','1'],['4','2'],['4','3']].map(([successor,predecessor])=>map('wbs_predecessor',successor,'wbs',predecessor,'FS')),
 map('wbs_finish','4','milestone','计划出水泥日期','finish')
];
const milestones=[{name:'计划出水泥日期',date:'2027-05-07',datePrecision:'day'}];

test('CPM is withheld until complete explicit WBS logic, durations and finish milestone exist',()=>{
 const missing=analyzeCriticalPath({progress:wbs,mappings:[],milestones});
 assert.equal(missing.verified,false);assert.deepEqual(missing.criticalWbs,[]);
 assert.match(missing.issues.join('；'),/工期|前置/);
 const withoutEnd=analyzeCriticalPath({progress:wbs,mappings:network,milestones:[]});
 assert.equal(withoutEnd.verified,false);
 const cycle=analyzeCriticalPath({progress:wbs,mappings:[...network,map('wbs_predecessor','1','wbs','4','FS')],milestones});
 assert.equal(cycle.verified,false);assert.match(cycle.issues.join('；'),/循环/);
});
test('complete explicit FS network yields exact longest path and noncritical float',()=>{
 const result=analyzeCriticalPath({progress:wbs,mappings:network,milestones});
 assert.equal(result.verified,true);assert.equal(result.calendar,'calendar-days');
 assert.equal(result.totalDurationDays,8);assert.deepEqual(result.criticalWbs,['1','2','4']);
 assert.equal(result.activities.find(x=>x.wbs==='3').totalFloatDays,2);
 assert.equal(result.finishDate,'2027-05-07');
});
test('monthly end-of-period plan is never compared as same-date to partial weekly actual',async()=>{
 const file=await readFile(new URL('./fixtures/Khayrat-progress-real.xlsx',import.meta.url));
 const parsed=await parseKhayratProgressWorkbook(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'Khayrat-progress-real.xlsx');
 const progress=parsed.currentRecords.map(row=>({...row,batchCurrentVersion:true,batchImportStatus:'complete'}));
 const weekly=[{recordType:'weekly-quantity',sourceType:'weekly-report',date:'2026-10-18',
   periodStart:'2026-10-12',periodEnd:'2026-10-18',workshop:'项目汇总',process:'混凝土',
   workCategory:'混凝土',workUnit:'m³',weeklyQuantity:100,weeklyCumulativeQuantity:3000,
   plannedTotalQuantity:6000}];
 const s=summarizeProgressWithWeekly({progress,reports:weekly,asOf:'2026-10-18'});
 assert.equal(s.plannedAsOf,'2026-09-30');
 assert.equal(s.actualAsOf,'2026-10-18');
 assert.equal(s.variance,null);assert.ok(s.basisIssues.length);
 assert.ok(s.lagging.every(row=>row.actualSourceDate===s.plannedAsOf));
 const october=s.timeline.find(x=>x.month==='2026-10-31');
 assert.ok(october);assert.equal(october.actualAsOf,'2026-10-18');
 const svg=renderProgressChart(s.timeline.map(x=>({...x,date:x.month})));
 assert.match(svg,/月中统计与本月月末计划不同期|月中周报累计/);
 assert.match(svg,/stroke-dasharray="5 5"/);
 assert.match(svg,/2026-10-18/);
});

test('mixed dates and unconfirmed multi-WBS allocation block decision use',()=>{
 const progress=[
  {projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',batchQualityStatus:'Verified',importBatchId:'p',wbs:'A',item:'混凝土 A',isLeaf:true,month:'2026-09-30',weight:50,total:100,plannedCumulativePct:50,actualCumulativePct:40},
  {projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',batchQualityStatus:'Verified',importBatchId:'p',wbs:'B',item:'混凝土 B',isLeaf:true,month:'2026-09-30',weight:50,total:100,plannedCumulativePct:50,actualCumulativePct:20}
 ];
 const reports=[{recordType:'weekly-quantity',sourceType:'weekly-report',periodStart:'2026-10-01',periodEnd:'2026-10-07',workCategory:'混凝土',workUnit:'m³',weeklyQuantity:10,weeklyCumulativeQuantity:80,plannedTotalQuantity:200}];
 const summary=summarizeProgressWithWeekly({reports,progress,asOf:'2026-10-07'});
 assert.ok(summary.reconciliation.some(row=>row.status==='retained'&&/多个 WBS/.test(row.reason)));
 assert.equal(summary.actual,30);assert.equal(summary.variance,-20);assert.equal(summary.decisionEligible,false);
});

test('human-confirmed WBS allocation can distribute weekly quantity with auditable ratios',()=>{
 const progress=[
  {projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',importBatchId:'p',wbs:'A',item:'混凝土 A',isLeaf:true,month:'2026-09-30',weight:50,total:100,plannedCumulativePct:50,actualCumulativePct:20},
  {projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',importBatchId:'p',wbs:'B',item:'混凝土 B',isLeaf:true,month:'2026-09-30',weight:50,total:100,plannedCumulativePct:50,actualCumulativePct:20}
 ];
 const reports=[{recordType:'weekly-quantity',sourceType:'weekly-report',periodStart:'2026-10-01',periodEnd:'2026-10-07',workCategory:'混凝土',workUnit:'m³',weeklyQuantity:10,weeklyCumulativeQuantity:80,plannedTotalQuantity:200}];
 const mappings=[
  {sourceType:'weekly_quantity',sourceValue:'混凝土',targetType:'wbs',targetValue:'A',relation:'allocation:0.25',note:'计划经理确认'},
  {sourceType:'weekly_quantity',sourceValue:'混凝土',targetType:'wbs',targetValue:'B',relation:'allocation:0.75',note:'计划经理确认'}
 ];
 const summary=summarizeProgressWithWeekly({reports,progress,mappings,asOf:'2026-10-07'});
 assert.equal(summary.reconciliation[0].method,'confirmed-allocation');
 assert.equal(summary.latest.find(row=>row.wbs==='A').actualCumulativePct,20);
 assert.equal(summary.latest.find(row=>row.wbs==='B').actualCumulativePct,60);
 assert.equal(summary.decisionEligible,false);
});
