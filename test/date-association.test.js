import test from 'node:test';
import assert from 'node:assert/strict';
import {associateReportDate,backfillStoredReportDates} from '../src/date-association.js';

test('one confirmed PDF report date updates every photo while preserving upload audit time',()=>{
  const records=[{id:'r1',sourceFile:'daily.pdf',workshop:'A',process:'钢筋',reviewFields:['date'],uploadedAt:'2026-10-13T09:00:00Z'}],images=[{imageId:'i1',sourceFile:'daily.pdf',uploadedAt:'2026-10-13T10:00:00Z'},{imageId:'i2',sourceFile:'daily.pdf',pageNumber:4,relatedRecordId:'r1',uploadedAt:'2026-10-13T10:01:00Z'}];
  const result=associateReportDate(records,images,{date:'2026-10-12',reason:'report-date',candidates:[{date:'2026-10-12',kind:'report-date'}]},{sourceFile:'daily.pdf'});assert.equal(result.filledImages,2);assert.deepEqual(images.map(image=>image.relatedDate),['2026-10-12','2026-10-12']);assert.equal(images[0].uploadedAt,'2026-10-13T10:00:00Z');assert.equal(records[0].date,'2026-10-12');assert.equal(records[0].reviewFields.includes('date'),false);assert.equal(images[1].relatedWorkshop,'A');assert.equal(images[1].relatedProcess,'钢筋');
});

test('historical backfill reuses stored full-document text and leaves conflicting files unresolved',()=>{
  const layout=[{pageNumber:1,height:840,text:'计划日期：2026-10-30',layout:{lines:[{text:'计划日期：2026-10-30',bbox:{y:20}}]}},{pageNumber:3,height:840,text:'报告日期：2026-10-12',layout:{lines:[{text:'报告日期：2026-10-12',bbox:{y:700}}]}}],records=[{id:'r',sourceFile:'daily.pdf',workshop:'A',process:'土方',reviewFields:['date'],documentLayout:layout},{id:'c',sourceFile:'conflict.pdf',documentLayout:[{pageNumber:1,height:840,layout:{lines:[{text:'报告日期：2026-10-11',bbox:{y:300}},{text:'报告日期：2026-10-12',bbox:{y:400}}]}}]}],images=[{imageId:'a',sourceFile:'daily.pdf'},{imageId:'b',sourceFile:'daily.pdf'},{imageId:'c',sourceFile:'conflict.pdf'}];const result=backfillStoredReportDates(records,images);assert.equal(result.filledImages,2);assert.equal(result.unresolvedImages,1);assert.equal(images[0].relatedDate,'2026-10-12');assert.equal(images[2].relatedDate,undefined);
});
