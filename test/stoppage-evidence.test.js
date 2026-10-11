import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeWorkshopStoppageEvidence} from '../src/stoppage-evidence.js';

const report=(date,changes={})=>({id:`r-${date}`,date,workshop:'A',process:'土方',status:'施工中',constructionContent:'基坑土石方破碎施工。',sourceFile:`${date}.pdf`,...changes});
const photo=(date,id,changes={})=>({imageId:id,relatedDate:date,relatedWorkshop:'A',relatedProcess:'土方',contentSignature:id,visionEnabled:true,scene:'施工中',stage:'土方施工阶段',structures:['矩形基坑'],activities:['土石方破碎施工'],visibleFacts:['基坑边缘堆积土石方'],...changes});

test('one evidence class stays suspected even across three effective report days',()=>{
 const rows=['2026-09-30','2026-10-07','2026-10-10'].map(date=>report(date,{process:'未报告工序',status:'当日暂无人员施工',constructionContent:'今日暂无人员施工。'}));
 const item=analyzeWorkshopStoppageEvidence(rows)[0];assert.equal(item.current.status,'疑似停滞');assert.equal(item.current.days,3);assert.deepEqual(item.current.categories,['personnel']);
});

test('three report days and two independent evidence classes become highly suspected',()=>{
 const dates=['2026-09-16','2026-09-30','2026-10-10'],rows=dates.map(report),images=dates.map((date,index)=>photo(date,`p${index}`));
 const item=analyzeWorkshopStoppageEvidence(rows,images)[0];assert.equal(item.current.status,'高度疑似停工');assert.equal(item.current.days,3);assert.deepEqual(new Set(item.current.categories),new Set(['text','photo']));
});

test('explicit stop confirms, while missing fields and a photo without a fingerprint do not',()=>{
 const confirmed=analyzeWorkshopStoppageEvidence([report('2026-10-10',{status:'停工',constructionContent:'日报明确记录停工。'})])[0];assert.equal(confirmed.current.status,'确认停工');
 const unknown=analyzeWorkshopStoppageEvidence([report('2026-10-10',{status:'',constructionContent:''})],[{imageId:'legacy',relatedDate:'2026-10-10',relatedWorkshop:'A',scene:'停工或无明显施工'}])[0];assert.equal(unknown.current.status,'数据不足');
});

test('latest active work marks a prior run as recovered and retains its history',()=>{
 const rows=['2026-09-16','2026-09-30','2026-10-07'].map(date=>report(date,{process:'未报告工序',status:'当日暂无人员施工',constructionContent:'今日暂无人员施工。'}));rows.push(report('2026-10-10',{process:'回填',status:'',constructionContent:'室内土方回填。'}));
 const item=analyzeWorkshopStoppageEvidence(rows)[0];assert.equal(item.current.status,'已恢复施工');assert.equal(item.current.recoveredFrom.status,'疑似停滞');assert.equal(item.current.recoveredFrom.days,3);assert.equal(item.history.length,1);
});

test('waiting and not-started states are not treated as stoppage evidence',()=>{
 const waiting=analyzeWorkshopStoppageEvidence([report('2026-10-10',{constructionContent:'电缆沟等待浇筑底板混凝土。'})])[0],notStarted=analyzeWorkshopStoppageEvidence([report('2026-10-10',{constructionContent:'该区域尚未开工。'})])[0];assert.equal(waiting.current.status,'等待施工');assert.equal(notStarted.current.status,'未开展施工');assert.deepEqual(waiting.current.categories,[]);
});

test('an exact reused photo contributes one photo category, never multiple independent classes',()=>{
 const rows=[report('2026-10-01',{constructionContent:'基坑巡视。'}),report('2026-10-10',{constructionContent:'现场检查。'})],images=[photo('2026-10-01','a',{contentSignature:'same'}),photo('2026-10-10','b',{contentSignature:'same'})],item=analyzeWorkshopStoppageEvidence(rows,images)[0];assert.equal(item.current.status,'疑似停滞');assert.deepEqual(item.current.categories,['photo']);assert.match(item.current.reasons.join(' '),/重复使用同一照片/);
});

test('visible active work in a linked photo blocks escalation from conflicting no-crew text',()=>{
 const dates=['2026-09-16','2026-09-30','2026-10-10'],rows=dates.map(date=>report(date,{process:'未报告工序',status:'当日暂无人员施工',constructionContent:'今日暂无人员施工。'})),images=dates.map((date,index)=>photo(date,`worker-${index}`,{visibleFacts:index===2?['两名施工人员正在绑扎钢筋']:['基坑边缘堆积土石方']}));
 const item=analyzeWorkshopStoppageEvidence(rows,images)[0];assert.notEqual(item.current.status,'高度疑似停工');assert.equal(item.current.status,'数据不足');
});

test('reviewed text, negated stoppage and another active process cannot confirm a workshop stop',()=>{
 const reviewed=analyzeWorkshopStoppageEvidence([report('2026-10-10',{status:'停工',constructionContent:'',reviewFields:['status']})])[0],negated=analyzeWorkshopStoppageEvidence([report('2026-10-10',{constructionContent:'未停工，持续浇筑施工。'})])[0],mixed=analyzeWorkshopStoppageEvidence([report('2026-10-10',{id:'stopped',process:'土方',status:'停工',constructionContent:'土方停工。'}),report('2026-10-10',{id:'active',process:'混凝土',status:'施工中',constructionContent:'底板混凝土浇筑施工。'})])[0];
 assert.notEqual(reviewed.current.status,'确认停工');assert.equal(negated.current.status,'正常施工');assert.equal(mixed.current.status,'正常施工');
});

test('a selected process never receives photo evidence from another process',()=>{
 const dates=['2026-10-01','2026-10-10'],rows=dates.map(date=>report(date,{process:'土方',constructionContent:'现场巡视。'})),images=dates.map((date,index)=>photo(date,`other-${index}`,{relatedProcess:'钢筋'})),item=analyzeWorkshopStoppageEvidence(rows,images,{process:'土方'})[0];
 assert.ok(!item.current.categories.includes('photo'));assert.deepEqual(item.current.photoIds,[]);
});

test('real Khayrat report excerpts preserve suspected, recovered and waiting distinctions',()=>{
 const real=[
  ...['2026-09-30','2026-10-07','2026-10-10'].map(date=>report(date,{id:`clinker-${date}`,workshop:'熟料输送',process:'未报告工序',status:'当日暂无人员施工',constructionContent:'今日暂无人员施工。'})),
  ...['2026-09-16','2026-09-30','2026-10-07'].map(date=>report(date,{id:`air-${date}`,workshop:'空压机房',process:'未报告工序',status:'当日暂无人员施工',constructionContent:'今日暂无人员施工。'})),
  report('2026-10-10',{id:'air-2026-10-10',workshop:'空压机房',process:'回填',status:'',constructionContent:'室内土方回填。'}),
  ...['2026-09-16','2026-09-30','2026-10-07','2026-10-10'].map(date=>report(date,{id:`waste-${date}`,workshop:'污水处理',process:'土石方破碎',constructionContent:'土石方破碎施工。'})),
  report('2026-10-10',{id:'water-2026-10-10',workshop:'循环水泵房',process:'土建施工（待复核）',constructionContent:'暂未安排施工。'}),
 ],result=analyzeWorkshopStoppageEvidence(real),byWorkshop=name=>result.find(item=>item.workshop===name).current;
 assert.equal(byWorkshop('熟料输送').status,'疑似停滞');assert.equal(byWorkshop('熟料输送').days,3);assert.equal(byWorkshop('空压机房').status,'已恢复施工');assert.equal(byWorkshop('污水处理').status,'疑似停滞');assert.equal(byWorkshop('污水处理').days,4);assert.equal(byWorkshop('循环水泵房').status,'等待施工');
});
