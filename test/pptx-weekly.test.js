import test from 'node:test';
import assert from 'node:assert/strict';
import {extractWeeklyFacts} from '../src/pptx.js';
import {analyzeWeeklyCrossSource} from '../src/project-data.js';

const page=(pageNumber,texts,tables=[])=>({pageNumber,texts,tables,notes:[],pictures:[]});
const pages=[
  page(1,['工程周报','(第','25','期)','2026年10月05日——2026年10月11日']),
  page(10,['项目进度描述'],[[['序号','子项名称','当前施工进展'],['1','水泥磨','梁、板钢筋绑扎施工进行中。']]]),
  page(11,['下周工作计划'],[[['序号','子项名称','下周计划'],['1','水泥磨','混凝土浇筑完成。']]]),
  page(13,['人员情况'],[[['序号','名称','中国人','当地人','合计','备注'],['汇总(分包+项目部)','','70','30','100','']]]),
  page(15,['现场机具情况'],[[['序号','种类','型号','数量(台)','使用情况','备注'],['1','挖掘机','550','1','在用','']]]),
  page(17,['工程量'],[[['序号','单位工程','单位','预估总量','累计完成量','完成百分比','上周计划量','本周完成量','下周计划','备注'],['6','钢筋','T','800','412','51.5%','26','28','26',''],['7','混凝土','m³','6000','3091','51.5%','200','211','200','']]])
];

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
});
