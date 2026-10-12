import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBFactory} from 'fake-indexeddb';
import {AuthSession,createAuthSession} from '../src/auth.js';
import {ProjectDatabase} from '../src/database.js';
import {normalizeRows,detectStoppages,analyzeRecords} from '../src/analytics.js';
import {mapPDFText,parsePDFDocument} from '../src/pdf.js';
import {compareReports} from '../src/comparison.js';
import {SupabaseCloudRepository} from '../src/cloud.js';

test('SDK restores verified session, receives rotation and clears on signout',async()=>{
  let listener;const session={access_token:'test-token'},client={auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:{id:'test-user'}}}),onAuthStateChange:fn=>(listener=fn,{data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({}),signInWithOtp:async()=>({})}};
  const auth=new AuthSession(client);assert.equal((await auth.initialize()).access_token,'test-token');listener('TOKEN_REFRESHED',{access_token:'rotated'});assert.equal(auth.session.access_token,'rotated');await auth.signOut();assert.equal(auth.session,null);
});
test('unverified restored session never authorizes cloud writes',async()=>{
  const auth=new AuthSession({auth:{getSession:async()=>({data:{session:{access_token:'expired'}}}),getUser:async()=>({error:new Error('revoked')}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}});
  await assert.rejects(()=>auth.initialize(),/revoked/);assert.equal(auth.session,null);
});
test('SDK configuration enables persistence/refresh and disables automatic signup',async()=>{
  let options,args;const auth=await createAuthSession({supabaseUrl:'https://test.invalid',supabaseAnonKey:'test-public'},{createClient:(url,key,opts)=>(options=opts,{auth:{signInWithOtp:async a=>(args=a,{})}})});
  await auth.signIn(' user@example.test ','http://localhost/');assert.equal(options.auth.autoRefreshToken,true);assert.equal(options.auth.persistSession,true);assert.equal(args.options.shouldCreateUser,false);assert.equal(args.email,'user@example.test');
});
test('shared model retains unknown values, invalid numeric/date inputs and source',()=>{
  const r=normalizeRows([{'日期':'2026-02-31','车间':'A','工序':'P','施工内容':'绑扎钢筋','当日混凝土':'unknown','中方人员':'1.5'}],'synthetic.csv',{allowIncomplete:true})[0];
  assert.equal(r.schemaVersion,2);assert.equal(r.date,'');assert.equal(r.dailyConcrete,null);assert.equal(r.constructionContent,'绑扎钢筋');assert.ok(r.reviewFields.includes('date'));assert.ok(r.reviewFields.includes('dailyConcrete'));assert.ok(r.reviewFields.includes('chineseStaff'));assert.equal(r.provenance.sourceFile,'synthetic.csv');
});
test('PDF label tokenizer separates equipment status and construction status',()=>{
  const r=mapPDFText('Date: 2026-10-03\nWorkshop: A\nProcess: P\nEquipment Status: Not arrived\nStatus: stopped\nUnit: m3\nDaily Quantity: unknown',{sourceFile:'synthetic.pdf',pageNumber:2})[0];
  assert.equal(r.status,'stopped');assert.equal(r.equipmentStatus,'Not arrived');assert.ok(r.reviewFields.includes('dailyConcrete'));assert.equal(r.provenance.pageNumber,2);
});
test('repeated PDF fields are marked ambiguous instead of silently trusted',()=>{const r=mapPDFText('Date: 2026-10-03 Workshop: A Process: P Workshop: B',{sourceFile:'test.pdf',pageNumber:1})[0];assert.ok(r.reviewFields.includes('workshop'));assert.equal(r.needsReview,true);});
test('missing personnel does not become zero-person stoppage evidence',()=>{const rows=[1,2,3,4].map(d=>({date:`2026-10-0${d}`,workshop:'A',process:'P',actualProgress:10,dailyConcrete:0,chineseStaff:null,localStaff:null}));assert.equal(detectStoppages(rows).length,0);});
test('missing/conflicting project personnel remains unknown instead of a made-up zero or maximum',()=>{const records=[{date:'2026-10-03',workshop:'A',process:'P',chineseStaff:2,localStaff:4,staffScope:'车间施工人数'}];assert.equal(analyzeRecords(records).kpis.totalStaff,null);records.push({...records[0],staffScope:'项目总人数'},{...records[0],staffScope:'项目总人数',chineseStaff:8});assert.equal(analyzeRecords(records).kpis.totalStaff,null);});

const report=(date,changes={})=>({date,workshop:'A',process:'P',activityId:'a1',status:'施工中',constructionContent:'work',dailyConcrete:5,cumulativeConcrete:10,workUnit:'m3',staffScope:'车间施工人数',chineseStaff:2,localStaff:4,sourceFile:`synthetic-${date}.pdf`,pageNumber:2,...changes});
test('two latest reports compare crew, quantities and preserve both sources',()=>{
  const result=compareReports([report('2026-10-01',{status:'停工',dailyConcrete:0}),report('2026-10-03',{dailyConcrete:8,cumulativeConcrete:18,chineseStaff:3})]);
  assert.equal(result.rows[0].classification,'改善');assert.equal(result.rows[0].changes.chineseStaff,1);assert.equal(result.rows[0].changes.dailyQuantity,8);assert.equal(result.rows[0].evidence.length,2);assert.equal(result.rows[0].evidence[0].pageNumber,2);assert.match(result.warnings[0],/不推断/);
});
test('missing activities/ambiguous matches are never assumed stopped or complete',()=>{const r=compareReports([report('2026-10-01'),report('2026-10-03',{activityId:'other'})]);assert.ok(r.rows.every(x=>x.classification==='信息不足'));const ambiguous=compareReports([report('2026-10-01'),report('2026-10-01',{sourceFile:'other.pdf'}),report('2026-10-03')]);assert.equal(ambiguous.rows[0].classification,'信息不足');assert.match(ambiguous.rows[0].notes.join(''),/全部保留/);});
test('different quantities/crew scopes and absent values do not yield fake deltas',()=>{const r=compareReports([report('2026-10-01'),report('2026-10-03',{workUnit:'t',staffScope:'项目总人数',localStaff:null})]).rows[0];assert.equal(r.changes.dailyQuantity,null);assert.equal(r.changes.localStaff,null);assert.ok(r.notes.length>=2);});
test('conflicting status/quantity signals and decreasing totals preserve values and mark differences',()=>{assert.equal(compareReports([report('2026-10-01',{status:'停工'}),report('2026-10-03',{dailyConcrete:1})]).rows[0].classification,'数据差异');assert.equal(compareReports([report('2026-10-01'),report('2026-10-03',{cumulativeConcrete:1})]).rows[0].classification,'数据差异');});
test('comparison merges workshop aliases, processes, activities and deduplicated photos into one card',()=>{
  const records=[
    report('2026-10-01',{id:'b1',workshop:'粉磨车间',process:'钢筋',activityId:'a1',constructionContent:'绑扎钢筋',dailyConcrete:2,cumulativeConcrete:5}),
    report('2026-10-01',{id:'b1-copy',workshop:'水泥粉磨车间',process:'钢筋',activityId:'a1',constructionContent:'绑扎钢筋',dailyConcrete:2,cumulativeConcrete:5,sourceFile:'copy.pdf'}),
    report('2026-10-01',{id:'b2',workshop:'水泥磨车间',process:'模板',activityId:'a2',constructionContent:'安装模板',dailyConcrete:3,cumulativeConcrete:7}),
    report('2026-10-03',{id:'a1',workshop:'水泥粉磨',process:'钢筋',activityId:'a1',constructionContent:'绑扎钢筋完成',dailyConcrete:4,cumulativeConcrete:9}),
    report('2026-10-03',{id:'a2',workshop:'水泥粉磨车间',process:'模板',activityId:'a2',constructionContent:'模板加固',dailyConcrete:5,cumulativeConcrete:12})
  ];
  const images=[
    {imageId:'p1',contentSignature:'same',relatedDate:'2026-10-03',relatedWorkshop:'粉磨车间',relatedProcess:'钢筋'},
    {imageId:'p1-copy',contentSignature:'same',relatedDate:'2026-10-03',relatedWorkshop:'水泥粉磨车间',relatedProcess:'钢筋'},
    {imageId:'p2',relatedDate:'2026-10-01',relatedWorkshop:'水泥磨车间',relatedProcess:'模板'}
  ];
  const result=compareReports(records,{images});assert.equal(result.rows.length,1);const row=result.rows[0];assert.equal(row.workshop,'水泥粉磨车间');assert.deepEqual(row.processes.before,['钢筋','模板']);assert.deepEqual(row.activities.before,['绑扎钢筋','安装模板']);assert.deepEqual(row.activities.after,['绑扎钢筋完成','模板加固']);assert.equal(row.photoCount,2);assert.equal(row.changes.dailyQuantity,4);assert.equal(row.evidence.length,5);
});
test('database preserves original file and local images on reload without cloud URLs',async()=>{
  const db=new ProjectDatabase(indexedDB),file=Object.assign(new Blob(['synthetic original']),{name:'test.pdf'});await db.saveOriginals([file],'batch');await db.replace([{id:'record',date:'2026-10-03',provenance:{excerpt:'source text'}}],[{imageId:'local-image',dataUrl:'data:image/png;base64,TEST'},{imageId:'cloud-image',objectPath:'private/path',signedUrl:'temporary-url',dataUrl:'data:image/png;base64,OTHER'}]);
  const snapshot=await db.load();assert.equal(snapshot.records[0].provenance.excerpt,'source text');assert.equal(snapshot.images.find(i=>i.imageId==='local-image').dataUrl,'data:image/png;base64,TEST');assert.equal(snapshot.images.find(i=>i.imageId==='cloud-image').signedUrl,undefined);assert.equal(await (await db.original('batch/test.pdf')).blob.text(),'synthetic original');(await db.open()).close();
});
test('anonymous writes and rows without stable IDs are rejected before network',async()=>{let calls=0;const repo=new SupabaseCloudRepository({supabaseUrl:'https://test.invalid',supabaseAnonKey:'test-public'},{fetchImpl:async()=>{calls++;}});await assert.rejects(()=>repo.request('/rest/v1/daily_reports',{method:'POST'}),/登录/);repo.token='synthetic';await assert.rejects(()=>repo.saveBatch([{}],[],{}),/稳定 ID/);assert.equal(calls,0);});
test('cloud reads merge payload with authoritative row IDs and project filter',async()=>{const calls=[];const repo=new SupabaseCloudRepository({supabaseUrl:'https://test.invalid',supabaseAnonKey:'test-public'},{accessToken:'synthetic',fetchImpl:async url=>(calls.push(url),{ok:true,json:async()=>url.includes('daily_reports')?[{id:'authoritative',payload:{id:'wrong',date:'2026-10-03'}}]:[]})});const r=await repo.loadProject();assert.equal(r.records[0].id,'authoritative');assert.ok(calls.every(u=>u.includes('project_id=eq.khayrat')));});
test('IndexedDB version upgrade preserves existing v1 reports and legacy image evidence',async()=>{
  const factory=new IDBFactory();const old=await new Promise((resolve,reject)=>{const r=factory.open('khayrat-project-data',1);r.onupgradeneeded=()=>{for(const [name,key] of [['reports','id'],['images','imageId'],['imports','importId']])r.result.createObjectStore(name,{keyPath:key});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=old.transaction(['reports','images'],'readwrite');tx.objectStore('reports').put({id:'legacy-record',date:'2026-10-01'});tx.objectStore('images').put({imageId:'legacy-photo',objectPath:'unverified-old-path',dataUrl:'data:image/jpeg;base64,OLD'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});old.close();
  const upgraded=new ProjectDatabase(factory),snapshot=await upgraded.load();assert.equal(snapshot.records[0].id,'legacy-record');await upgraded.replace(snapshot.records,snapshot.images);assert.equal((await upgraded.load()).images[0].dataUrl,'data:image/jpeg;base64,OLD');(await upgraded.open()).close();
});
