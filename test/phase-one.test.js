import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {parseXLSX,parseKhayratProgressWorkbook} from '../src/xlsx.js';
import {applyBatchContext,installationReadiness,weeklyTasks,actionUpdate,shipmentImportDelta,reviewShipmentChange} from '../src/phase-one.js';
import {mergeRiskActions} from '../src/decision-controls.js';
import {civilReadiness,shipmentLifecycle} from '../src/equipment-intelligence.js';
import {parsePackingWorkbook} from '../src/packing-workbook.js';

test('legacy binary XLS reads all report sheets, skips instructions and preserves rows',async()=>{
 const book=XLSX.utils.book_new();
 for(const name of ['说明','日报一','日报二'])XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['日期','车间'],['2026-10-27',name]]),name);
 const data=XLSX.write(book,{bookType:'biff8',type:'array'}),rows=await parseXLSX(data);
 assert.equal(rows.length,2);assert.equal(rows[1].__sourceSheet,'日报二');assert.equal(rows[1].__sourceRow,2);
});

test('native packing master excludes translations, examples, nested items and totals',async()=>{
 const book=XLSX.utils.book_new(),rows=[['项目名称','','测试','','运输批次','B01'],['总件数','',1],['序号','供货厂家','外包装编号.','货物名称','部件名称','装箱明细','规格型号','数量'],[1,'供应商','P1','电机','','','',1],[2,'供应商','P2','电机','','','',1],['','','','','','','规格',100],['合计','','','','','','',102]];
 for(const name of ['制表说明','中文总装箱单','英文总装箱单','中文明细装箱单'])XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),name);
 const result=await parsePackingWorkbook(XLSX.write(book,{bookType:'biff8',type:'array'}));
 assert.equal(result.length,2);assert.equal(result[0]['发运批次'],'B01');assert.match(result[0].__packingReview,/总件数 1.*箱件 2/);assert.equal(result[0].__sourceRow,4);
});

test('batch site milestone does not turn undelivered packages into arrivals',()=>{
 const control={status:'ready',siteArrivalDate:'2026-10-27',arrivalDate:'2026-10-20'};
 const a=applyBatchContext({id:'a',siteArrivalDate:'2026-10-27'},control),b=applyBatchContext({id:'b'},control);
 assert.equal(shipmentLifecycle(a).state,'arrived');assert.notEqual(shipmentLifecycle(b).state,'arrived');assert.equal(b.arrivalDate,undefined);
 assert.equal(installationReadiness(a).ready,false);
 assert.equal(civilReadiness({status:'confirmed',workshop:'水泥磨'},[{date:'2026-10-27',workshop:'水泥磨',constructionContent:'基础完成'}],'2026-10-30').state,'unknown');
});

test('all four installation checks require explicit confirmation and evidence',()=>{
 const installationChecks=Object.fromEntries(['equipmentComplete','drawingsAvailable','foundationHandover','crewAndTools'].map(k=>[k,{confirmed:true,evidence:'移交记录编号'}]));
 assert.equal(installationReadiness({installationChecks}).ready,true);installationChecks.crewAndTools.evidence='';assert.equal(installationReadiness({installationChecks}).ready,false);
});

test('weekly plans keep stable IDs, original promise, postponement and evidence-gated closure',()=>{
 const report={date:'2026-10-20',workshop:'水泥磨',nextWeekPlan:'安装电机；基础验收',sourceFile:'周报.pptx'};
 const tasks=weeklyTasks([report,{...report,date:'2026-10-27'}]);assert.equal(tasks.length,2);assert.equal(tasks[0].sources.length,2);
 let action=actionUpdate({id:tasks[0].id},{owner:'施工',dueDate:'2026-10-22',status:'open'},tasks[0],'2026-10-20T00:00:00Z');
 action=actionUpdate(action,{dueDate:'2026-11-02',status:'monitoring'},tasks[0],'2026-10-30T00:00:00Z');
 assert.equal(action.history.find(h=>h.originalDueDate).originalDueDate,'2026-10-22');assert.equal(action.history.at(-1).previousDueDate,'2026-10-22');
 assert.throws(()=>actionUpdate(action,{status:'closed',closureNote:''},tasks[0]));
 const merged=mergeRiskActions([], [action],'2026-11-03');assert.equal(merged.items[0].id,tasks[0].id);assert.equal(merged.items[0].owner,'施工');assert.equal(merged.items[0].overdue,true);assert.ok(merged.items[0].sources.length);
});

test('source says resolved does not close an issue without human closure evidence',()=>{
 assert.equal(mergeRiskActions([{id:'risk',status:'resolved'}],[]).items[0].status,'active');
 assert.equal(mergeRiskActions([],[{id:'risk',status:'closed',closureNote:'验收记录 1'}]).items[0].status,'resolved');
});

test('repeat import is a no-op and changed/translated rows preserve original and manual history',()=>{
 const original={id:'one',shipmentBatch:'B01',packageLot:'001',equipmentName:'电机',quantity:2,manualControl:{siteArrivalDate:'2026-10-27'},manualHistory:[{at:'2026-10-27'}]};
 const repeated=shipmentImportDelta([original],[original]);assert.equal(repeated.writes.length,0);
 const delta=shipmentImportDelta([original],[{...original,id:'two',equipmentName:'Motor',quantity:3}]);assert.equal(delta.added.length,0);assert.equal(delta.rows[0].quantity,2);assert.equal(delta.rows[0].manualControl.siteArrivalDate,'2026-10-27');assert.equal(delta.rows[0].pendingImportChanges.length,1);
 assert.equal(shipmentImportDelta(delta.rows,[{...original,id:'two',equipmentName:'Motor',quantity:3}]).writes.length,0);
});

test('human quantity review keeps raw quantities and records the prior manual layer',()=>{
 const row={id:'x',quantity:2,manualControl:{siteArrivalDate:'2026-10-27'},pendingImportChanges:[{fields:['quantity'],candidate:{quantity:3,sourceFile:'revision.xls'}}]};
 const reviewed=reviewShipmentChange(row,0,'adopt');assert.equal(reviewed.quantity,2);assert.equal(reviewed.manualControl.quantity,3);assert.equal(reviewed.manualControl.siteArrivalDate,'2026-10-27');assert.equal(reviewed.manualHistory.length,1);assert.throws(()=>reviewShipmentChange(reviewed,0,'adopt'));
});
