import test from 'node:test';import assert from 'node:assert/strict';import {IDBFactory} from 'fake-indexeddb';
import {normalizeProgressRows as progress,normalizeShipmentRows as shipments,normalizeCrosswalkRows as mappings,analyzeProgress,crossAnalyze} from '../src/project-data.js';
import {SupabaseCloudRepository} from '../src/cloud.js';import {ProjectDatabase} from '../src/database.js';import {ReportStore,EvidenceStore,STORAGE_KEY} from '../src/storage.js';
const row=(wbs='A',weight=100,month='2026-09',actual=40)=>({WBS:wbs,权重:weight,月份:month,计划累计完成比例:70,实际累计完成比例:actual});
test('stable IDs are project scoped, lossless, case-sensitive and supplier aware',()=>{
 assert.notEqual(progress([row()],'a','khayrat')[0].id,progress([row()],'a','other')[0].id);
 for(const [a,b] of [['A-B','A B'],['A','a'],['x'.repeat(190)+'a','x'.repeat(190)+'b']])assert.notEqual(progress([row(a)])[0].id,progress([row(b)])[0].id);
 const base={'设备类别':'磨机','设备名称':'同名设备','Package/Lot':'B1'};assert.notEqual(shipments([{...base,供应商:'A'}])[0].id,shipments([{...base,供应商:'B'}])[0].id);
 assert.equal(progress([row()],'a')[0].id,progress([row()],'b')[0].id);
});
test('monthly cutoff, complete WBS denominator, future actuals and stale observations fail closed',()=>{
 const rows=progress([row('A',60),row('B',40,'2026-09',null),row('A',60,'2026-11',90)]);
 const a=analyzeProgress(rows,{asOf:'2026-10-06'});assert.equal(a.cutoff,'2026-09-30');assert.equal(a.actual,null);assert.equal(a.totalWeight,100);assert.equal(a.coverage.actual.coveredWeight,60);assert.equal(a.timeline.at(-1).actual,null);
 assert.equal(analyzeProgress(progress([row()]),{asOf:'2026-09-29'}).actual,null);
 assert.equal(analyzeProgress(progress([row()]),{asOf:'2026-09-30'}).actual,40);
 assert.equal(analyzeProgress(progress([row('A',100,'2026-08')]),{asOf:'2026-10-06'}).actual,null);
 assert.equal(analyzeProgress(progress([row('A',60),row('A',100,'2026-08')]),{asOf:'2026-10-06'}).actual,null);
 assert.equal(progress([row('A',100,'2026-13')])[0].needsReview,true);
});
test('typed graph allows reverse and multi-hop matches while excluding same text in wrong types and stale records',()=>{
 const p=progress([row('CIV')]),s=shipments([{'设备类别':'Mill','设备名称':'same','Package/Lot':'B1','当前状态':'现场到货'}]);
 const m=mappings([{'来源类型':'daily_workshop','来源值':'Mill','目标类型':'wbs','目标值':'CIV'}]);
 assert.equal(crossAnalyze({progress:p,shipments:s,mappings:m,asOf:'2026-10-06'}).length,0);
 const valid=mappings([{'来源类型':'installation_area','来源值':'AREA','目标类型':'equipment_category','目标值':'Mill'},{'来源类型':'installation_area','来源值':'AREA','目标类型':'wbs','目标值':'CIV'}]);
 assert.equal(crossAnalyze({progress:p,shipments:s,mappings:valid,asOf:'2026-10-06'}).length,1);
 assert.equal(crossAnalyze({progress:p,shipments:s,mappings:valid,asOf:'2026-11-06'}).length,0);
 assert.equal(crossAnalyze({progress:p,shipments:s.map(x=>({...x,status:'未到现场'})),mappings:valid,asOf:'2026-10-06'}).length,0);
 assert.equal(crossAnalyze({progress:p,shipments:s,mappings:valid.map(x=>({...x,projectId:'other'})),asOf:'2026-10-06'}).length,0);
});
test('cloud loads each table with its own primary key and only degrades confirmed missing tables',async()=>{
 const calls=[],repo=new SupabaseCloudRepository({supabaseUrl:'https://test.invalid',supabaseAnonKey:'public',projectId:'other'},{accessToken:'jwt',fetchImpl:async url=>{calls.push(new URL(url));return {ok:true,json:async()=>[]};}});await repo.loadProject();assert.equal(calls.length,8);for(const url of calls){assert.equal(url.searchParams.get('project_id'),'eq.other');assert.equal(url.searchParams.get('order'),url.pathname.endsWith('image_evidence')?'image_id':url.pathname.endsWith('progress_import_batches')?'imported_at.desc,id.desc':'id');}
 repo.fetch=async url=>url.includes('progress_measurements')?{ok:false,status:404,json:async()=>({code:'PGRST205',message:'public.progress_measurements does not exist'})}:{ok:true,json:async()=>[]};assert.deepEqual((await repo.loadProject()).unavailableTables,['progress_measurements']);
 for(const status of [401,403,404,500]){repo.fetch=async()=>({ok:false,status,json:async()=>({message:'failure'})});await assert.rejects(()=>repo.loadProject(),new RegExp(String(status)));}
});
test('cloud hydration keeps completed progress history but excludes incomplete batches and preserves evidence upload time',async()=>{
 const tables={daily_reports:[],image_evidence:[{image_id:'photo',project_id:'khayrat',updated_at:'2026-10-12T08:00:00Z',payload:{sourceFile:'daily.pdf'}}],progress_measurements:[{id:'current-row',project_id:'khayrat',import_batch_id:'current',payload:{sourceType:'progress-workbook',snapshotRole:'current',importBatchId:'current'}},{id:'failed-row',project_id:'khayrat',import_batch_id:'failed',payload:{sourceType:'progress-workbook',snapshotRole:'current',importBatchId:'failed'}}],equipment_shipments:[],crosswalk_mappings:[],progress_import_batches:[{id:'current',project_id:'khayrat',import_status:'complete',current_version:true,imported_at:'2026-10-12T09:00:00Z'},{id:'failed',project_id:'khayrat',import_status:'failed',current_version:false,imported_at:'2026-10-12T10:00:00Z'}]};
 const repo=new SupabaseCloudRepository({supabaseUrl:'https://test.invalid',supabaseAnonKey:'public'},{accessToken:'jwt',fetchImpl:async url=>{const table=new URL(url).pathname.split('/').at(-1);return {ok:true,json:async()=>tables[table]||[]};}}),snapshot=await repo.loadProject();
 assert.deepEqual(snapshot.progress.map(row=>row.id),['current-row']);assert.equal(snapshot.progress[0].batchCurrentVersion,true);assert.equal(snapshot.images[0].uploadedAt,'2026-10-12T08:00:00Z');
});
test('cloud rejects cross-project or unscoped legacy project-data IDs before any writes',async()=>{
 let calls=0;const repo=new SupabaseCloudRepository({supabaseUrl:'https://test.invalid',supabaseAnonKey:'public'},{accessToken:'jwt',fetchImpl:async()=>{calls++;return {ok:true};}});
 await assert.rejects(()=>repo.saveProjectData('progress',progress([row()],'a','other')),/跨项目/);await assert.rejects(()=>repo.saveProjectData('progress',[{...progress([row()])[0],id:'old-id'}]),/稳定 ID/);assert.equal(calls,0);
});
test('IndexedDB and localStorage scopes survive account/project switching and leave legacy originals untouched',async()=>{
 const factory=new IDBFactory(),legacy=new ProjectDatabase(factory);await legacy.replace([{id:'legacy'}],[]);await legacy.saveOriginals([Object.assign(new Blob(['original']),{name:'old.pdf'})],'batch');
 const db=new ProjectDatabase(factory);db.setScope('khayrat','user-a');await db.replace([{id:'same',value:'a'}],[{imageId:'photo',dataUrl:'data:image/png;base64,AAAA'}]);await db.replaceProjectData('progress',[{id:'p'}]);await db.replace([],[]);assert.equal((await db.load()).records[0].value,'a');
 db.setScope('khayrat','user-b');assert.equal((await db.load()).records.length,0);await db.replace([{id:'same',value:'b'}],[]);
 db.setScope('other','user-a');assert.equal((await db.load()).records.length,0);db.setScope('khayrat','user-a');assert.equal((await db.load()).records[0].value,'a');assert.equal((await db.load()).progress.length,1);assert.equal((await legacy.load()).records[0].id,'legacy');assert.equal(await (await legacy.original('batch/old.pdf')).blob.text(),'original');
 const data=new Map([[STORAGE_KEY,'[{"id":"legacy"}]']]),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},store=new ReportStore(storage),evidence=new EvidenceStore(storage);store.setScope('khayrat','a');store.write([{id:'a'}]);evidence.setScope('khayrat','a');evidence.write([{imageId:'a'}]);store.setScope('khayrat','b');evidence.setScope('khayrat','b');assert.deepEqual(store.all(),[]);assert.deepEqual(evidence.all(),[]);store.setScope('khayrat','a');assert.equal(store.all()[0].id,'a');assert.equal(data.get(STORAGE_KEY),'[{"id":"legacy"}]');
});

test('a delayed operation cannot send old data using a different account token',async()=>{
 let writes=0;const repo=new SupabaseCloudRepository({supabaseUrl:'https://test.invalid',supabaseAnonKey:'public'},{userId:'a',auth:{current:async()=>({access_token:'b-token',user:{id:'b'}})},fetchImpl:async()=>{writes++;return {ok:true};}});await assert.rejects(()=>repo.saveProjectData('progress',progress([row()])),/登录身份已改变/);assert.equal(writes,0);
});
