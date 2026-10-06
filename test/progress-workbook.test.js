import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseKhayratProgressWorkbook} from '../src/xlsx.js';
import {analyzeProgress,currentProgressRows,summarizeProgress} from '../src/project-data.js';

const fixture=new URL('./fixtures/Khayrat-progress-real.xlsx',import.meta.url);
const close=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
async function parse(){const file=await readFile(fixture);return parseKhayratProgressWorkbook(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'Khayrat粉磨站进度跟踪表.xlsx');}

test('real Khayrat workbook identifies sheets, current V1 and historical V0',async()=>{
 const parsed=await parse();
 assert.deepEqual(parsed.batch.sheetNames,['工程量实际','工程量计划(V1)','工程量计划(V0)','合同要求','机装电气资金计划']);
 assert.equal(parsed.batch.currentPlanVersion,'V1');assert.equal(parsed.batch.currentPlanSheet,'工程量计划(V1)');assert.equal(parsed.batch.actualSheet,'工程量实际');
 assert.equal(parsed.batch.periodCount,14);assert.equal(parsed.batch.lastActualPeriod,'2026-09-30');assert.equal(parsed.batch.fileHash,'147b791d988d5c7d824bf1cedebe54ea3cbb31d38d3ce4386613a04ecada9c6d');
 assert.equal(parsed.currentRecords.length,19*14);assert.equal(parsed.records.length,19*14*2);assert.equal(new Set(parsed.currentRecords.map(row=>row.wbs)).size,19);
 assert.equal(parsed.planComparison.from,'V0');assert.equal(parsed.planComparison.to,'V1');assert.equal(parsed.planComparison.quantityAdjusted.length,3);assert.equal(parsed.planComparison.weightAdjusted.length,0);assert.equal(parsed.planComparison.scheduleAdjusted.length,13);
});

test('real workbook recomputes WBS quantities and cross-checks cached Excel totals',async()=>{
 const parsed=await parse(),result=analyzeProgress(parsed.records,{asOf:'2026-10-06'});
 close(result.planned,29.468854772678302);close(result.actual,13.325019607843137);close(result.variance,-16.143835164835167);close(result.plannedMonthly,13.79865869424693);close(result.actualMonthly,4.069133333333333);
 assert.equal(parsed.validation.planMatches,true);assert.equal(parsed.validation.sourceActualMatches,true);close(parsed.validation.reportedActualPct,20.7490196078431);close(parsed.validation.computedSourceActualPct,20.749019607843138);close(parsed.validation.computedActualPct,13.325019607843137);
 assert.deepEqual(parsed.quantityMismatches.map(row=>[row.wbs,row.baselineTotal,row.trackingTotal,row.status]),[['1.2',10000,6000,'To Be Verified'],['1.3',1200,800,'To Be Verified']]);
 const concrete=parsed.currentRecords.find(row=>row.wbs==='1.2'&&row.period==='M6');assert.equal(concrete.plannedMonthlyQuantity,2500);assert.equal(concrete.actualMonthlyQuantity,794);close(concrete.actualCumulativePct,28.8);close(concrete.sourceActualCumulativePct,48);
});

test('zero-weight leaf is excluded without double counting and disciplines keep both metrics',async()=>{
 const parsed=await parse(),summary=summarizeProgress(parsed.records,{asOf:'2026-10-06'}),civil=summary.disciplines.find(row=>row.name==='土建工程');
 assert.equal(summary.totalWeight,1);assert.deepEqual(summary.issues,[]);close(civil.actualCompletion,26.650039215686274);close(civil.contributionToProject,13.325019607843137);assert.notEqual(civil.actualCompletion,civil.contributionToProject);
 assert.equal(summary.lagging[0].wbs,'1.7');assert.equal(summary.lagging[1].wbs,'1.2');
});

test('same file hash is stable and a newer batch becomes current while the old snapshot remains',async()=>{
 const first=await parse(),again=await parse();assert.equal(first.batch.id,again.batch.id);assert.equal(first.batch.fileHash,again.batch.fileHash);
 const previous=first.currentRecords.map(row=>({...row,importBatchId:'progress:khayrat:previous',fileHash:'0'.repeat(64),importedAt:'2026-09-30T00:00:00Z',actualCumulativePct:Number.isFinite(row.actualCumulativePct)?Math.max(0,row.actualCumulativePct-2):null}));
 assert.equal(new Set([...previous,...first.records].map(row=>row.importBatchId)).size,2);assert.equal(currentProgressRows([...previous,...first.records])[0].importBatchId,first.batch.id);
 const summary=summarizeProgress([...previous,...first.records],{asOf:'2026-10-06'});assert.ok(summary.versionDiff);assert.equal(summary.versionDiff.previous.id,'progress:khayrat:previous');assert.ok(summary.versionDiff.actualChange>0);
});
