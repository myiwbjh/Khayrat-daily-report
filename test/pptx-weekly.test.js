import test from 'node:test';
import assert from 'node:assert/strict';
import {extractWeeklyFacts,weeklyPhotoPeriod} from '../src/pptx.js';
import {analyzeWeeklyCrossSource,summarizeProgressWithWeekly} from '../src/project-data.js';

const page=(pageNumber,texts,tables=[])=>({pageNumber,texts,tables,notes:[],pictures:[]});
const pages=[
  page(1,['工程周报','(第','25','期)','2026年10月05日——2026年10月11日']),
  page(10,['项目进度描述'],[[['序号','子项名称','当前施工进展'],['1','水泥磨','梁、板钢筋绑扎施工进行中。']]]),
  page(11,['下周工作计划'],[[['序号','子项名称','下周计划'],['1','水泥磨','混凝土浇筑完成。']]]),
  page(13,['人员情况'],[[['序号','名称','中国人','当地人','合计','备注'],['汇总(分包+项目部)','','70','30','100','']]]),
  page(15,['现场机具情况'],[[['序号','种类','型号','数量(台)','使用情况','备注'],['1','挖掘机','550','1','在用','']]]),
  page(17,['工程量'],[[['序号','单位工程','单位','预估总量','累计完成量','完成百分比','上周计划量','本周完成量','下周计划','备注'],['6','钢筋','T','800','412','51.5%','26','28','26',''],['7','混凝土','m³','6000','3091','51.5%','200','211','200','']]])
];

test('weekly photo period follows explicit labels and geometry, never the report date or picture order',()=>{
 const page={texts:['六、主要工作开展情况','上周','本周'],textShapes:[{text:'上周',x:500,y:100,width:500,height:100},{text:'本周',x:6500,y:100,width:500,height:100}]};
 assert.equal(weeklyPhotoPeriod(page,{x:6200,width:5000}).period,'本周');
 assert.equal(weeklyPhotoPeriod(page,{x:300,width:5000}).period,'上周');
 assert.equal(weeklyPhotoPeriod({...page,textShapes:[]},{x:6200,width:5000}).period,'待核对');
 assert.equal(weeklyPhotoPeriod({texts:['六、主要工作开展情况'],textShapes:[]},{x:0,width:100}).period,'本周');
});

test('PPTX native weekly facts retain period, quantities, workforce and provenance',()=>{
  const result=extractWeeklyFacts(pages,{fileHash:'sample-hash',sourceFile:'第25期.pptx'}),concrete=result.records.find(row=>row.workCategory==='混凝土'),rebar=result.records.find(row=>row.workCategory==='钢筋'),people=result.records.find(row=>row.recordType==='personnel-summary');
  assert.deepEqual(result.metadata,{issueNumber:25,periodStart:'2026-10-05',periodEnd:'2026-10-11',statusCount:1,quantityCount:2,equipmentCount:1,riskCount:0,personnelCount:1});
  assert.deepEqual([concrete.plannedTotalQuantity,concrete.weeklyCumulativeQuantity,concrete.weeklyQuantity],[6000,3091,211]);
  assert.deepEqual([rebar.plannedTotalQuantity,rebar.weeklyCumulativeQuantity,rebar.weeklyQuantity],[800,412,28]);
  assert.deepEqual([people.chineseStaff,people.localStaff,people.totalStaff],[70,30,100]);
  assert.equal(concrete.pageNumber,17);assert.equal(concrete.sourceFile,'第25期.pptx');assert.equal(result.records[0].pages.length,6);
});

test('weekly cross analysis keeps weekly, daily and official Excel values separate',()=>{
  const weekly=extractWeeklyFacts(pages,{fileHash:'sample-hash',sourceFile:'第25期.pptx'}).records,daily=[{projectId:'khayrat',sourceType:'pdf',date:'2026-10-06',workshop:'水泥磨',process:'混凝土',dailyConcrete:200,cumulativeConcrete:3080,sourceFile:'日报1006.pdf',pageNumber:2},{projectId:'khayrat',sourceType:'pdf',date:'2026-10-10',workshop:'水泥磨',process:'混凝土',dailyConcrete:10,cumulativeConcrete:3090,sourceFile:'日报1010.pdf',pageNumber:2}],progress=[{projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',importBatchId:'excel-1',importedAt:'2026-10-12',wbs:'1.2',item:'混凝土',month:'2026-09-30',baselineTotal:6000,total:6000,actualCumulativePct:50,sourceFile:'工程量.xlsx',sourceRow:8,sheetName:'工程量实际'}],result=analyzeWeeklyCrossSource({reports:[...daily,...weekly],progress,asOf:'2026-10-11'}),concrete=result.rows.find(row=>row.kind==='concrete');
  assert.equal(concrete.weekly.increment,211);assert.equal(concrete.daily.increment,210);assert.equal(concrete.excel.cumulative,3000);assert.equal(concrete.diffs.weeklyVsDailyIncrement,1);assert.equal(concrete.diffs.weeklyVsExcelCumulative,91);assert.equal(result.rule.includes('不跨来源相加'),true);
  assert.deepEqual(concrete.latestMeasured,{source:'weekly-report',asOf:'2026-10-11',value:3091,official:false});assert.equal(concrete.pendingOfficialUpdate,true);
});

test('weekly comparison requires the same quantity unit and does not silently replace Excel',()=>{
  const weekly=extractWeeklyFacts(pages,{fileHash:'sample-hash',sourceFile:'第25期.pptx'}).records,progress=[{projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',importBatchId:'excel-1',importedAt:'2026-10-12',wbs:'X',item:'混凝土',unit:'t',month:'2026-09-30',baselineTotal:6000,total:6000,actualCumulativePct:50,sourceFile:'错误单位.xlsx'}],result=analyzeWeeklyCrossSource({reports:weekly,progress,asOf:'2026-10-11'}),concrete=result.rows.find(row=>row.kind==='concrete');
  assert.equal(concrete.excel.cumulative,null);assert.match(concrete.issues.join('；'),/同类别同单位/);assert.equal(concrete.weekly.cumulative,3091);
});

test('latest weekly quantity becomes actual progress while uncovered WBS keeps its latest sourced value',()=>{
  const weekly=extractWeeklyFacts(pages,{fileHash:'sample-hash',sourceFile:'第25期.pptx'}).records,progress=[
    {projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',importBatchId:'excel-1',importedAt:'2026-10-12',wbs:'C-01',item:'混凝土',unit:'m3',weight:60,month:'2026-09-30',baselineTotal:6000,total:6000,plannedCumulativePct:55,actualCumulativePct:50,sourceFile:'工程量.xlsx'},
    {projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',importBatchId:'excel-1',importedAt:'2026-10-12',wbs:'E-01',item:'电气安装',unit:'项',weight:40,month:'2026-09-30',baselineTotal:10,total:10,plannedCumulativePct:30,actualCumulativePct:20,sourceFile:'工程量.xlsx'}
  ],result=summarizeProgressWithWeekly({reports:weekly,progress,asOf:'2026-10-11'}),concrete=result.latest.find(row=>row.wbs==='C-01'),electrical=result.latest.find(row=>row.wbs==='E-01');
  assert.equal(Number(concrete.actualCumulativePct.toFixed(3)),51.517);assert.equal(concrete.actualSourceType,'weekly-report');assert.equal(concrete.actualSourceDate,'2026-10-11');assert.equal(electrical.actualCumulativePct,20);assert.equal(electrical.actualSourceType,'progress-workbook');assert.equal(result.actualAsOf,'2026-10-11');assert.equal(Number(result.actual.toFixed(3)),38.91);
  const october=result.timeline.find(row=>row.month==='2026-10-31');assert.equal(october.actual,result.actual);assert.equal(october.actualMonthly,null);assert.equal(result.actualMonthly,null);assert.equal(result.timeline.some(row=>row.month==='2026-10-11'),false);assert.equal(result.variance,null);assert.match(result.basisIssues[0],/截止日不同/);
});

test('weekly cumulative outside the matching Excel quantity is retained as a discrepancy, not clamped or allocated',()=>{
  const weekly=extractWeeklyFacts(pages,{fileHash:'sample-hash',sourceFile:'第25期.pptx'}).records.map(row=>row.recordType==='weekly-quantity'&&row.workCategory==='混凝土'?{...row,weeklyCumulativeQuantity:7000}:row),progress=[
    {projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',importBatchId:'excel-1',wbs:'C-01',item:'混凝土',unit:'m3',weight:100,month:'2026-09-30',baselineTotal:6000,actualCumulativePct:50}
  ],result=summarizeProgressWithWeekly({reports:weekly,progress,asOf:'2026-10-11'});
  assert.equal(result.actual,50);assert.equal(result.actualBasis,'progress-workbook');assert.match(result.reconciliation.find(row=>row.label==='混凝土').reason,/超出同类别 Excel 总量/);
});
