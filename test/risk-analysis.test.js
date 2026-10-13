import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeProjectRisks} from '../src/risk-analysis.js';

test('risk analysis separates confirmed facts, inference and resolved history without duplicates',()=>{
  const reports=[
    {projectId:'khayrat',date:'2026-10-05',workshop:'水泥磨',process:'施工',status:'停工',risk:'等待设计图纸，现场暂停施工',sourceFile:'日报1005.pdf',pageNumber:2},
    {projectId:'khayrat',date:'2026-10-06',workshop:'水泥磨',process:'施工',status:'停工',risk:'等待设计图纸，现场暂停施工',sourceFile:'日报1006.pdf',pageNumber:2},
    {projectId:'khayrat',date:'2026-10-11',workshop:'水泥磨',process:'施工',status:'恢复施工',risk:'设计图纸问题已解决，恢复施工',sourceFile:'周报25.pptx',pageNumber:18},
    {projectId:'khayrat',date:'2026-10-04',staffScope:'项目总人数',totalStaff:120,sourceFile:'周报24.pptx'},
    {projectId:'khayrat',date:'2026-10-11',staffScope:'项目总人数',totalStaff:90,sourceFile:'周报25.pptx'}
  ];
  const progress=[{projectId:'khayrat',sourceType:'progress-workbook',snapshotRole:'current',batchCurrentVersion:true,batchImportStatus:'complete',importBatchId:'p1',importedAt:'2026-10-01',wbs:'CIV-01',item:'基础',weight:100,month:'2026-09-30',plannedCumulativePct:60,actualCumulativePct:40,sourceFile:'进度.xlsx'}];
  const result=analyzeProjectRisks({reports,progress,asOf:'2026-10-11'}),design=result.items.find(item=>item.category==='设计图纸'),people=result.items.find(item=>item.category==='人员资源');
  assert.equal(design.factType,'confirmed');assert.equal(design.status,'resolved');assert.equal(design.sources.length,3);assert.equal(design.responsibility,'设计');
  assert.equal(people.factType,'inference');assert.equal(people.severity,'high');assert.equal(result.items.some(item=>item.factType==='unconfirmed'&&item.category==='关键路径'),true);assert.equal(result.counts.resolved>=1,true);assert.equal(new Set(result.items.map(item=>item.key)).size,result.items.length);
});

test('steel silo logistics without foundation handover stays explicitly unconfirmed',()=>{
  const shipments=[{projectId:'khayrat',shipmentBatch:'B01',category:'钢板仓',equipmentName:'钢板仓筒体',status:'已发运',shippingDate:'2026-10-08',sourceFile:'B01箱单.xlsx',sourceRow:12}],result=analyzeProjectRisks({shipments,reports:[],progress:[],asOf:'2026-10-11'}),risk=result.items.find(item=>item.key==='unconfirmed:silo-installation-readiness');
  assert.equal(risk.factType,'unconfirmed');assert.equal(risk.severity,'high');assert.equal(risk.responsibility,'采购/物流');assert.match(risk.basis,/未找到基础验收/);
});
