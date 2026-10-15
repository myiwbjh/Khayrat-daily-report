import test from 'node:test';
import assert from 'node:assert/strict';
import {latestWorkshopStates,standardWorkshop,workshopAliasAudit} from '../src/workshop-status.js';

test('confirmed workshop synonyms merge without changing source records',()=>{
  const records=[
    {id:'d1',date:'2026-10-01',workshop:'空压机房',process:'基础',constructionContent:'施工'},
    {id:'d2',date:'2026-10-02',workshop:'空压机',process:'安装',constructionContent:'安装'},
    {id:'w1',date:'2026-10-02',workshop:'水泥粉磨车间',process:'钢筋',constructionContent:'绑扎',sourceType:'weekly-report',recordType:'weekly-workshop-status'},
    {id:'d3',date:'2026-10-02',workshop:'水泥磨',process:'模板',constructionContent:'支模'},
    {id:'d4',date:'2026-10-02',workshop:'混合材破碎、输送及电气室',process:'电气',constructionContent:'配管'},
  ];
  const original=structuredClone(records),states=latestWorkshopStates(records);
  assert.deepEqual(states.map(row=>row.workshop),['混合材破碎及输送','空压机','水泥磨']);
  assert.deepEqual(records,original);
});

test('manual alias provenance overrides defaults and distinct relation splits safely',()=>{
  const merge=[{id:'m1',sourceType:'workshop_alias',sourceValue:'磨房',targetType:'workshop',targetValue:'水泥磨',relation:'alias',sourceFile:'Admin 手动维护',note:'现场确认'}];
  assert.equal(standardWorkshop('磨房',merge),'水泥磨');
  const split=[{id:'m2',sourceType:'workshop_alias',sourceValue:'空压机房',targetType:'workshop',targetValue:'空压机房',relation:'distinct',sourceFile:'Editor 手动维护',note:'确认不同区域'}];
  assert.equal(standardWorkshop('空压机房',split),'空压机房');
});

test('audit scans daily, weekly, photos, WBS and leaves uncertain names pending',()=>{
  const audit=workshopAliasAudit({records:[{id:'d',workshop:'水泥粉磨车间'},{id:'w',workshop:'原料车间',sourceType:'weekly-report'}],images:[{imageId:'p',relatedWorkshop:'空压机房'},{imageId:'q',relatedWorkshop:'原料'}],progress:[{id:'x',item:'混合材破碎、输送及电气室'}]});
  assert.equal(audit.mergedOccurrences,3);
  assert.ok(audit.pending.some(row=>new Set([row.left,row.right]).has('原料车间')&&new Set([row.left,row.right]).has('原料')));
});
