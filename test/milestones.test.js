import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {DEFAULT_MILESTONES,normalizeMilestone,sortMilestones,milestoneDateLabel} from '../src/milestones.js';

test('milestones sort by date then explicit same-day order and format month precision',()=>{
 const rows=sortMilestones([{name:'B',date:'2026-09-07',sortOrder:20},{name:'A',date:'2026-09-07',sortOrder:10},{name:'Earlier',date:'2026-03-01',datePrecision:'month'}]);
 assert.deepEqual(rows.map(row=>row.name),['Earlier','A','B']);
 assert.equal(milestoneDateLabel(rows[0]),'2026 年 3 月');
 assert.equal(normalizeMilestone({name:'X',date:'2026-01-01',circleColor:'red'}).circleColor,'#168b82');
 assert.equal(DEFAULT_MILESTONES.length,3);
});

test('Reader reads milestones but RLS denies writes; Editor/Admin writes are audited',async()=>{
 const db=new PGlite(),editor='00000000-0000-4000-8000-000000000001',reader='00000000-0000-4000-8000-000000000002',admin='00000000-0000-4000-8000-000000000003';
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${editor}'),('${reader}'),('${admin}');create table public.project_members(project_id text,user_id uuid,role text,is_admin boolean default false,primary key(project_id,user_id));alter table public.project_members enable row level security;grant select on public.project_members to authenticated;create policy own_membership on public.project_members for select to authenticated using(user_id=(select auth.uid()));insert into public.project_members values('khayrat','${editor}','editor',false),('khayrat','${reader}','reader',false),('khayrat','${admin}','reader',true);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261014050349_editable_project_milestones.sql',import.meta.url),'utf8'));
  const assume=async uid=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');};
  await assume(reader);assert.equal((await db.query("select * from project_milestones where deleted_at is null")).rows.length,3);assert.equal((await db.query("update project_milestones set name='blocked' where id='00000000-0000-4000-8000-000000000101' returning id")).rows.length,0);
  await assume(editor);await db.query("update project_milestones set name='施工启动' where id='00000000-0000-4000-8000-000000000101'");assert.equal((await db.query("select action,changed_by from project_milestone_audits")).rows[0].changed_by,editor);
  await assume(admin);await db.query("insert into project_milestones(project_id,name,milestone_date) values('khayrat','管理节点','2027-01-01')");assert.equal((await db.query("select count(*)::int count from project_milestone_audits")).rows[0].count,2);
 }finally{await db.close();}
});
