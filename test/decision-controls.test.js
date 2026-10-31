import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {progressDecisionState,equipmentBatchHealth,normalizeEquipmentControl,mergeRiskActions} from '../src/decision-controls.js';

test('progress decision gate blocks missing data and labels mismatched WBS values provisional',()=>{
 assert.equal(progressDecisionState({selected:[]}).status,'blocked');
 const value=progressDecisionState({selected:[{wbs:'A'}],qualityIssues:[{wbs:'A'}]});assert.equal(value.status,'provisional');assert.equal(value.decisionReady,false);
 assert.equal(progressDecisionState({selected:[{wbs:'A',batchQualityStatus:'Verified'}],qualityIssues:[]}).decisionReady,true);
});

test('equipment batch readiness requires lifecycle fields, construction links and clean source rows',()=>{
 const rows=[{shipmentBatch:'B01',eta:'2026-10-10',arrivalDate:'2026-10-12',status:'现场到货',_computedAnomalies:[]}],control=normalizeEquipmentControl({batchName:'B01',customsStatus:'放行',siteArrivalDate:'2026-10-13',installationArea:'磨房',linkedWbs:['CIV-01'],responsible:'EPC',dueDate:'2026-10-14',status:'ready'}),ready=equipmentBatchHealth(rows,[control],[],'2026-10-14').items[0];
 assert.equal(ready.decisionReady,true);assert.equal(ready.mappingCoverage,100);
 const blocked=equipmentBatchHealth([{shipmentBatch:'B02',_computedAnomalies:['缺少件号']}],[],[],'2026-10-14').items[0];assert.equal(blocked.decisionReady,false);assert.ok(blocked.blockers.includes('未关联 WBS / 车间'));
});

test('risk actions persist ownership, overdue state and evidence-backed closure',()=>{
 const base={id:'risk-1',severity:'high',status:'active'},open=mergeRiskActions([base],[{id:'risk-1',owner:'项目经理',dueDate:'2026-10-10',status:'monitoring'}],'2026-10-14');assert.equal(open.items[0].overdue,true);assert.equal(open.counts.high,1);
 const closed=mergeRiskActions([base],[{id:'risk-1',owner:'项目经理',status:'closed',closureNote:'已验收'}],'2026-10-14');assert.equal(closed.items[0].status,'resolved');assert.equal(closed.counts.resolved,1);
 assert.equal(mergeRiskActions([{...base,status:'resolved'}],[],'2026-10-14').items[0].status,'active');
});

test('decision-control migration lets members read, editors write and readers cannot mutate',async()=>{const db=new PGlite(),editor='00000000-0000-4000-8000-000000000001',reader='00000000-0000-4000-8000-000000000002';try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${editor}'),('${reader}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create table public.project_members(project_id text,user_id uuid,role text,is_admin boolean default false);insert into public.project_members values('khayrat','${editor}','editor',false),('khayrat','${reader}','reader',false);grant select on public.project_members to authenticated;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261014180226_decision_controls.sql',import.meta.url),'utf8'));
 const assume=async uid=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');};
 await assume(editor);await db.exec("insert into equipment_batch_controls(id,project_id,batch_name) values('b1','khayrat','B01')");await db.exec("insert into risk_actions(id,project_id,status) values('r1','khayrat','open')");
 await assume(reader);assert.equal((await db.query('select * from equipment_batch_controls')).rows.length,1);assert.equal((await db.query('select * from risk_actions')).rows.length,1);await assert.rejects(db.exec("insert into risk_actions(id,project_id) values('r2','khayrat')"),/row-level security/);assert.equal((await db.query("update equipment_batch_controls set status='ready' returning *")).rows.length,0);await assert.rejects(db.exec('delete from risk_actions'),/permission denied/);
 }finally{await db.close();}});
