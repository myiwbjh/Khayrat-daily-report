import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const editor='00000000-0000-4000-8000-000000000001',reader='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
test('migration enforces real PostgreSQL member/editor RLS, grants, immutable identity and legacy Storage boundary',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; insert into auth.users values('${editor}'),('${reader}'),('${other}');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261005_multi_source_architecture.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261006142538_progress_workbook_versions.sql',import.meta.url),'utf8'));
 await db.exec(`insert into project_members values('khayrat','${editor}','editor'),('khayrat','${reader}','reader'),('other','${other}','editor');`);
 const assume=async(role,uid='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec(`set role ${role}`);};
 for(const table of ['progress_measurements','equipment_shipments','crosswalk_mappings']){
  await assume('anon');await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
  await assume('authenticated',other);assert.equal((await db.query(`select * from ${table}`)).rows.length,0);await assert.rejects(db.query(`insert into ${table}(id,project_id,payload) values('a','khayrat','{}')`),/row-level security/);
  await assume('authenticated',editor);await db.query(`insert into ${table}(id,project_id,payload) values('a','khayrat','{}')`);await db.query(`insert into ${table}(id,project_id,payload) values('a','khayrat','{"retry":true}') on conflict(id) do update set id=excluded.id,project_id=excluded.project_id,source_file=excluded.source_file,payload=excluded.payload,updated_at=excluded.updated_at`);
  assert.equal((await db.query(`select * from ${table}`)).rows[0].payload.retry,true);
  await assert.rejects(db.query(`update ${table} set project_id='other' where id='a'`),/immutable|row-level security/);
  await assert.rejects(db.query(`delete from ${table}`),/permission denied/);
  await assume('authenticated',reader);assert.equal((await db.query(`select * from ${table}`)).rows.length,1);await assert.rejects(db.query(`insert into ${table}(id,project_id,payload) values('b','khayrat','{}')`),/row-level security/);assert.equal((await db.query(`update ${table} set payload='{}' where id='a' returning id`)).rows.length,0);
  await assume('authenticated',other);assert.equal((await db.query(`select * from ${table}`)).rows.length,0);await assert.rejects(db.query(`insert into ${table}(id,project_id,payload) values('a','other','{}') on conflict(id) do update set project_id=excluded.project_id,payload=excluded.payload`),/row-level security/);
 }
 await assume('authenticated',editor);assert.equal((await db.query('select * from project_members')).rows.length,1);await assert.rejects(db.query(`insert into project_members values('other','${editor}','editor')`),/permission denied/);await assert.rejects(db.query('update project_members set role=\'editor\''),/permission denied/);
 await assume('authenticated',other);assert.equal((await db.query(`update progress_measurements set payload='{}' where id='a' returning id`)).rows.length,0);
 await assume('anon');await assert.rejects(db.query('select * from progress_import_batches'),/permission denied/);
 await assume('authenticated',editor);await db.query(`insert into progress_import_batches(id,project_id,file_hash,source_file) values('batch','khayrat','${'a'.repeat(64)}','real.xlsx')`);assert.equal((await db.query('select current_version from progress_import_batches')).rows.length,1);await assert.rejects(db.query("update progress_import_batches set file_hash='"+'b'.repeat(64)+"' where id='batch'"),/immutable/);await assert.rejects(db.query('delete from progress_import_batches'),/permission denied/);
 await assume('authenticated',reader);assert.equal((await db.query('select source_file from progress_import_batches')).rows[0].source_file,'real.xlsx');await assert.rejects(db.query(`insert into progress_import_batches(id,project_id,file_hash,source_file) values('reader','khayrat','${'c'.repeat(64)}','bad.xlsx')`),/row-level security/);
 await assume('authenticated',other);assert.equal((await db.query('select * from progress_import_batches')).rows.length,0);
 await db.exec('reset role');await db.exec(`create schema storage;create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;create policy owner_only on storage.objects for all to authenticated using(bucket_id='khayrat-reports' and auth.uid()='${editor}') with check(bucket_id='khayrat-reports' and auth.uid()='${editor}');insert into storage.objects values('khayrat-reports','khayrat/old-import/original.pdf'),('khayrat-reports','other/secret.pdf');`);
 await db.exec(await readFile(new URL('../supabase/storage-member-boundary.sql',import.meta.url),'utf8'));
 await assume('authenticated',editor);assert.deepEqual((await db.query('select name from storage.objects')).rows.map(r=>r.name),['khayrat/old-import/original.pdf']);await db.query("insert into storage.objects values('khayrat-reports','khayrat/new/photo.png')");await assert.rejects(db.query("insert into storage.objects values('khayrat-reports','other/new.pdf')"),/row-level security/);await assert.rejects(db.query("update storage.objects set name='other/moved.pdf' where name='khayrat/new/photo.png'"),/row-level security/);
 assert.equal((await db.query("delete from storage.objects where name='khayrat/old-import/original.pdf' returning name")).rows.length,0);
 await assume('authenticated',other);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await assume('authenticated',reader);assert.equal((await db.query('select * from storage.objects')).rows.length,0); // Owner policy is intentionally not widened.
 }finally{await db.close();}
});
