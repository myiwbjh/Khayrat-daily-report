import test from 'node:test';
import assert from 'node:assert/strict';
import {equipmentAssociation,shipmentIntelligence} from '../src/equipment-intelligence.js';

test('explicit equipment names map to workshop while generic components stay pending',()=>{
  assert.deepEqual(equipmentAssociation({equipmentName:'水泥磨',componentName:'筒体'}).workshop,'水泥磨');
  assert.deepEqual(equipmentAssociation({equipmentName:'KLT空压机'}).workshop,'空压机');
  assert.deepEqual(equipmentAssociation({equipmentName:'1#包装机'}).workshop,'水泥包装及散装车间');
  const pending=equipmentAssociation({category:'除尘通风',equipmentName:'袋收尘器',remark:'图号 83.01'});
  assert.equal(pending.status,'pending');assert.match(pending.basis,/待确认/);
});

test('missing logistics nodes remain information gaps and do not become arrival facts',()=>{
  const shipments=[{projectId:'khayrat',id:'s1',shipmentBatch:'B02',equipmentName:'水泥磨',category:'粉磨设备',sourceFile:'B02.xlsx',sourceRow:8}],reports=[{projectId:'khayrat',date:'2026-10-18',workshop:'水泥磨',constructionContent:'6.8m梁柱模板钢筋施工中',sourceFile:'周报.pptx',pageNumber:12}],result=shipmentIntelligence({shipments,reports,asOf:'2026-10-18'});
  assert.equal(result.items[0].lifecycle.state,'unknown');assert.equal(result.items[0].civil.state,'not-ready');assert.equal(result.counts.confirmedConflicts,0);assert.equal(result.counts.potentialConflicts,0);assert.ok(result.risks.some(risk=>risk.scope==='水泥磨'&&risk.factType==='unconfirmed'));
});

test('site arrival plus unfinished civil work is a confirmed high conflict with both sources',()=>{
  const shipments=[{projectId:'khayrat',id:'s1',shipmentBatch:'B02',equipmentName:'水泥磨',status:'现场到货',sourceFile:'B02.xlsx',sourceRow:8}],reports=[{projectId:'khayrat',date:'2026-10-18',workshop:'水泥磨',constructionContent:'设备基础模板施工中',sourceFile:'日报.pdf',pageNumber:3}],result=shipmentIntelligence({shipments,reports,asOf:'2026-10-18'}),risk=result.risks.find(item=>item.scope==='水泥磨');
  assert.equal(risk.factType,'confirmed');assert.equal(risk.severity,'high');assert.equal(risk.sources.length,2);assert.equal(result.counts.confirmedConflicts,1);
});

test('confirmed crosswalk overrides inference and reuses workshop aliases',()=>{
  const mappings=[{sourceType:'equipment_item',sourceValue:'专用机组',targetType:'workshop',targetValue:'空压机站',sourceFile:'设计映射.xlsx'}],association=equipmentAssociation({equipmentName:'专用机组'},mappings);
  assert.equal(association.status,'confirmed');assert.equal(association.workshop,'空压机');assert.match(association.basis,/已确认映射/);
});
