begin;
alter table public.project_members add column if not exists is_admin boolean not null default false;
-- Existing approved owner only; no new enrollment or privilege granted to arbitrary users.
update public.project_members m set is_admin=true from auth.users u
 where m.user_id=u.id and m.project_id='khayrat' and m.role='editor' and lower(u.email)='myiwbjh@gmail.com';
create table if not exists public.public_dashboard_snapshots (
 project_id text primary key, payload jsonb not null, published_at timestamptz not null,
 published_by uuid not null references auth.users(id)
);
alter table public.public_dashboard_snapshots enable row level security;
revoke all on public.public_dashboard_snapshots from public,anon,authenticated;
grant all on public.public_dashboard_snapshots to service_role;
-- Authenticated clients never write membership or publication; controlled server only.
revoke all on public.project_members from anon,authenticated;
grant select on public.project_members to authenticated;
do $$ declare t text; begin
 foreach t in array array['daily_reports','image_evidence','import_audits'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to authenticated',t);
  execute format('create policy "project read" on public.%I for select to authenticated using (exists(select 1 from public.project_members m where m.project_id=%I.project_id and m.user_id=(select auth.uid())))',t,t);
  execute format('create policy "project editor insert" on public.%I for insert to authenticated with check (exists(select 1 from public.project_members m where m.project_id=%I.project_id and m.user_id=(select auth.uid()) and m.role=''editor''))',t,t);
  execute format('create policy "project editor update" on public.%I for update to authenticated using (exists(select 1 from public.project_members m where m.project_id=%I.project_id and m.user_id=(select auth.uid()) and m.role=''editor'')) with check (exists(select 1 from public.project_members m where m.project_id=%I.project_id and m.user_id=(select auth.uid()) and m.role=''editor''))',t,t,t);
  execute format('create policy "project member boundary" on public.%I as restrictive for all to authenticated using (exists(select 1 from public.project_members m where m.project_id=%I.project_id and m.user_id=(select auth.uid()))) with check (exists(select 1 from public.project_members m where m.project_id=%I.project_id and m.user_id=(select auth.uid())))',t,t,t);
  execute format('create policy "project write boundary" on public.%I as restrictive for insert to authenticated with check (exists(select 1 from public.project_members m where m.project_id=%I.project_id and m.user_id=(select auth.uid()) and m.role=''editor''))',t,t);
  execute format('create policy "project update boundary" on public.%I as restrictive for update to authenticated using (exists(select 1 from public.project_members m where m.project_id=%I.project_id and m.user_id=(select auth.uid()) and m.role=''editor'')) with check (exists(select 1 from public.project_members m where m.project_id=%I.project_id and m.user_id=(select auth.uid()) and m.role=''editor''))',t,t,t);
 end loop;
end $$;
-- Audit is append only for users.
revoke update on public.import_audits from authenticated;
create policy "project object read" on storage.objects for select to authenticated
 using(bucket_id='khayrat-reports' and split_part(name,'/',1)='khayrat' and exists(select 1 from public.project_members m where m.project_id='khayrat' and m.user_id=(select auth.uid())));
create policy "project object insert" on storage.objects for insert to authenticated
 with check(bucket_id='khayrat-reports' and split_part(name,'/',1)='khayrat' and exists(select 1 from public.project_members m where m.project_id='khayrat' and m.user_id=(select auth.uid()) and m.role='editor'));
create policy "project object update" on storage.objects for update to authenticated
 using(bucket_id='khayrat-reports' and split_part(name,'/',1)='khayrat' and exists(select 1 from public.project_members m where m.project_id='khayrat' and m.user_id=(select auth.uid()) and m.role='editor'))
 with check(bucket_id='khayrat-reports' and split_part(name,'/',1)='khayrat' and exists(select 1 from public.project_members m where m.project_id='khayrat' and m.user_id=(select auth.uid()) and m.role='editor'));
create policy "project object write boundary" on storage.objects as restrictive for insert to authenticated
 with check(bucket_id='khayrat-reports' and split_part(name,'/',1)='khayrat' and exists(select 1 from public.project_members m where m.project_id='khayrat' and m.user_id=(select auth.uid()) and m.role='editor'));
create policy "project object update boundary" on storage.objects as restrictive for update to authenticated
 using(bucket_id='khayrat-reports' and split_part(name,'/',1)='khayrat' and exists(select 1 from public.project_members m where m.project_id='khayrat' and m.user_id=(select auth.uid()) and m.role='editor'))
 with check(bucket_id='khayrat-reports' and split_part(name,'/',1)='khayrat' and exists(select 1 from public.project_members m where m.project_id='khayrat' and m.user_id=(select auth.uid()) and m.role='editor'));
-- No direct deletes of original files. Logo cleanup is a narrowly checked server operation.
create policy "no direct file delete" on storage.objects as restrictive for delete to authenticated using(false);
commit;

begin;
create table public.vision_runs (
 image_id text primary key references public.image_evidence(image_id) on delete cascade,
 project_id text not null default 'khayrat', state text not null check(state in ('running','success','failed')),
 analysis jsonb, attempts jsonb not null default '[]', updated_at timestamptz not null default now()
);
alter table public.vision_runs enable row level security;
revoke all on public.vision_runs from public,anon,authenticated;
grant select,insert,update on public.vision_runs to authenticated;
create policy "vision member read" on public.vision_runs for select to authenticated using(exists(select 1 from public.project_members m where m.project_id=vision_runs.project_id and m.user_id=(select auth.uid())));
create policy "vision editor insert" on public.vision_runs for insert to authenticated with check(exists(select 1 from public.project_members m where m.project_id=vision_runs.project_id and m.user_id=(select auth.uid()) and m.role='editor') and exists(select 1 from public.image_evidence e where e.image_id=vision_runs.image_id and e.project_id=vision_runs.project_id));
create policy "vision editor update" on public.vision_runs for update to authenticated using(exists(select 1 from public.project_members m where m.project_id=vision_runs.project_id and m.user_id=(select auth.uid()) and m.role='editor')) with check(exists(select 1 from public.project_members m where m.project_id=vision_runs.project_id and m.user_id=(select auth.uid()) and m.role='editor') and exists(select 1 from public.image_evidence e where e.image_id=vision_runs.image_id and e.project_id=vision_runs.project_id));
commit;
