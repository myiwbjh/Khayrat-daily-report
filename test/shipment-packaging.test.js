import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {b01PackingFixture} from './fixtures/b01-packaging.mjs';
import {parsePackingWorkbook} from '../src/packing-workbook.js';
import {normalizeShipmentRows,summarizeShipments,mergeShipmentRecords} from '../src/project-data.js';
import {shipmentPackaging} from '../src/shipment-packaging.js';
import {shipmentImportDelta,applyBatchContext} from '../src/phase-one.js';

async function imported(){
 const {master,detail}=b01PackingFixture(),book=XLSX.utils.book_new();
 for(const [name,data] of [['中文总装箱单',master],['英文总装箱单',master],['中文明细装箱单',detail]])XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(data),name);
 const raw=await parsePackingWorkbook(XLSX.write(book,{bookType:'biff8',type:'array'}));
 return {raw,rows:normalizeShipmentRows(raw,'B01-20260716.xls')};
}
test('B01 preserves 49 source rows but totals only 46 outer packages and excludes contents weight',async()=>{
 const {raw,rows}=await imported(),summary=summarizeShipments(rows);
 assert.equal(raw.length,49);assert.equal(rows.length,49);assert.equal(new Set(rows.map(r=>r.id)).size,49);
 assert.equal(summary.packages,46);assert.equal(summary.records,49);assert.equal(summary.contents,3);assert.equal(summary.quantity,46);assert.equal(summary.pendingConfirmation,true);
 assert.equal(summary.grossWeightKg,35804); // 30*100 + (3100+3200+3300) + 10*100 + 9300 + 4527 + 8377
 const contents=rows.filter(r=>shipmentPackaging(r).kind==='contents');
 assert.deepEqual(contents.map(r=>r.packageSequence),['45','46','48']);
 assert.deepEqual(contents.map(r=>shipmentPackaging(r).parentPackageLot),['Khayat-1','Khayat-1','Khayat-2']);
 assert.ok(contents.every(r=>shipmentPackaging(r).status==='pending-confirmation'));
 assert.equal(rows[44].rawSource.row,49);assert.equal(rows[44].rawSource.values[7],1);
 assert.equal(rows[47].detailSources[0].row,97);assert.equal(rows[47].detailSources[1].row,98);
 assert.equal(rows[46].detailSources[0].row,96);assert.equal(rows[48].detailSources[0].row,106);
 assert.match(rows[0].packingReview,/46 件外包装（待确认）.*3 条箱内设备/);
});
test('same-number HBYH packages remain three records with their own detail sources through repeat import',async()=>{
 const {rows}=await imported(),hbyh=rows.filter(r=>r.packageLot==='HBYH-1/3');
 assert.equal(hbyh.length,3);assert.equal(mergeShipmentRecords(hbyh).length,3);
 assert.deepEqual(hbyh.map(r=>r.detailSources[0].row),[80,81,82]);
 const first=shipmentImportDelta([],rows),again=shipmentImportDelta(first.rows,rows);
 assert.equal(first.added.length,49);assert.equal(again.rows.length,49);assert.equal(again.writes.length,0);
 assert.equal(summarizeShipments(hbyh).packages,3);assert.ok(hbyh.every(r=>r._computedAnomalies.includes('件号重复')));
});
test('legacy rows get read-only classification without changing source or manual history; B02 is unaffected',async()=>{
 const {rows}=await imported();
 const legacy=rows.map(({packaging,rawSource,packingReview,detailSources,...r})=>({...r,manualControl:{siteArrivalDate:'2026-10-20'},manualHistory:[{note:'人工确认'}]}));
 const before=JSON.stringify(legacy),summary=summarizeShipments(legacy.map(r=>applyBatchContext(r,{})));
 assert.equal(summary.packages,46);assert.equal(JSON.stringify(legacy),before);
 const delta=shipmentImportDelta(legacy,rows);assert.equal(delta.added.length,0);assert.equal(delta.rows.length,49);
 assert.ok(delta.rows.every(r=>r.manualHistory[0].note==='人工确认'));assert.equal(shipmentImportDelta(delta.rows,rows).writes.length,0);
 const other=rows.map(r=>({...r,shipmentBatch:'B02'}));assert.equal(summarizeShipments(other).packages,49);
 assert.equal(shipmentPackaging({...legacy[44],supplier:'其他供应商'}).kind,'outer');
 assert.equal(shipmentPackaging({...legacy[44],packageLot:'独立包装'}).kind,'outer');
 assert.equal(shipmentPackaging(applyBatchContext({...legacy[44],manualControl:{equipmentName:'修正名称',componentName:'修正部件'}},{})).kind,'contents');
});
