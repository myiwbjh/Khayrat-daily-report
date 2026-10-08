import test from 'node:test';import assert from 'node:assert/strict';
import {publicProjection} from '../server/public-dashboard.js';
import {summarizeProgress} from '../src/project-data.js';
import publicHandler from '../api/public-dashboard.js';
test('full public output allowlists all business domains and preserves WBS selection',()=>{
 const secret={sourceFile:'private.pdf',originalObjectPath:'private/path',fileHash:'secret-hash',rawRecord:'private-excerpt',user_id:'private-user',apiKey:'secret',provenance:{excerpt:'private-excerpt'}};
 const reports=[{...secret,date:'2026-10-01',workshop:'A',process:'钢筋',constructionContent:'施工',staffScope:'项目总人数',chineseStaff:70,localStaff:23,personnelStatistics:{...secret,scope:'project',timeBasis:'current',issues:['待核']}}];
 const progress=[{...secret,wbs:'A',month:'2026-09-30',weight:100,actualCumulativePct:40,plannedCumulativePct:50,sourceType:'progress-workbook',snapshotRole:'current',importBatchId:'private-batch',importedAt:'2026-10-01',quantityMismatch:true,baselineTotal:100,trackingTotal:80}];
 const output=publicProjection(reports,progress,[],{asOf:'2026-10-07',shipments:[{...secret,equipmentName:'磨机',status:'现场到货'}],mappings:[{...secret,sourceType:'workshop',sourceValue:'A',targetType:'wbs',targetValue:'A',relation:'related'}]});
 assert.equal(output.schemaVersion,2);assert.equal(output.reports[0].constructionContent,'施工');assert.equal(output.shipments[0].equipmentName,'磨机');assert.equal(output.mappings[0].targetValue,'A');assert.deepEqual(output.reports[0].personnelStatistics.issues,['待核']);
 const summary=summarizeProgress(output.progressRecords,{asOf:'2026-10-07'});assert.equal(summary.actual,40);assert.equal(summary.planned,50);assert.equal(summary.qualityIssues.length,1);
 for(const word of ['private','secret','provenance','originalObjectPath','sourceFile','apiKey'])assert.ok(!JSON.stringify(output).includes(word),word);
});
test('public dashboard rejects mutation before database access',async()=>{const response={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};await publicHandler({method:'POST'},response);assert.equal(response.code,405);});

test('incomplete and explicitly excluded reports never enter the public snapshot',()=>{const p=publicProjection([{date:'',constructionContent:'待核施工记录',needsReview:true,reviewFields:['date']},{date:'2026-10-01',workshop:'A',process:'施工',constructionContent:'旧占位',publicationEligible:false},{date:'2026-10-01',workshop:'A',process:'施工',constructionContent:'可公开'}],[],[]);assert.equal(p.reports.length,1);assert.equal(p.reports[0].constructionContent,'可公开');assert.equal(p.workshops.length,1);});
