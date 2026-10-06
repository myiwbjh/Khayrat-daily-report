-- Fresh installations only. Existing installations use reviewed migrations.
create extension if not exists pgcrypto;
create table if not exists public.daily_reports (id text primary key, project_id text not null default 'khayrat', report_date date, workshop text, process text, activity_id text, source_file text, payload jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.image_evidence (image_id text primary key, project_id text not null default 'khayrat', report_id text references public.daily_reports(id) on delete set null, source_file text, page_number integer, payload jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.import_audits (import_id uuid primary key default gen_random_uuid(), project_id text not null default 'khayrat', user_id uuid default auth.uid(), files jsonb not null default '[]', result jsonb not null default '{}', created_at timestamptz not null default now());
-- REVIEW ONLY: not applied to production. Seed approved auth.users UUIDs separately.
begin;
create table if not exists public.project_members (
  project_id text not null check (project_id ~ '^[a-z][a-z0-9_-]*$'),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('reader','editor')),
  primary key(project_id,user_id)
);
alter table public.project_members enable row level security;
revoke all on public.project_members from public, anon, authenticated;
grant select on public.project_members to authenticated;
create policy "read own memberships" on public.project_members for select to authenticated
  using (user_id = (select auth.uid()));
create function public.keep_project_data_identity() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if new.id is distinct from old.id or new.project_id is distinct from old.project_id then
  raise exception 'project data identity is immutable' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.keep_project_data_identity() from public,anon,authenticated;
-- There is no self-enrollment policy, no client mutation grant, and no automatic seed.

create table if not exists public.progress_measurements (id text primary key, project_id text not null, source_file text, payload jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists progress_measurements_project_idx on public.progress_measurements(project_id);
alter table public.progress_measurements enable row level security;
revoke all on public.progress_measurements from public, anon, authenticated;
grant select,insert on public.progress_measurements to authenticated;
grant update on public.progress_measurements to authenticated;
create trigger immutable_project_identity before update on public.progress_measurements for each row execute function public.keep_project_data_identity();
create policy "member boundary" on public.progress_measurements as restrictive for all to authenticated
 using (exists (select 1 from public.project_members m where m.project_id = progress_measurements.project_id and m.user_id = (select auth.uid())))
 with check (exists (select 1 from public.project_members m where m.project_id = progress_measurements.project_id and m.user_id = (select auth.uid())));
create policy "member read" on public.progress_measurements for select to authenticated
 using (exists (select 1 from public.project_members m where m.project_id = progress_measurements.project_id and m.user_id = (select auth.uid())));
create policy "editor insert" on public.progress_measurements for insert to authenticated
 with check (exists (select 1 from public.project_members m where m.project_id = progress_measurements.project_id and m.user_id = (select auth.uid()) and m.role='editor'));
create policy "editor update" on public.progress_measurements for update to authenticated
 using (exists (select 1 from public.project_members m where m.project_id = progress_measurements.project_id and m.user_id = (select auth.uid()) and m.role='editor'))
 with check (exists (select 1 from public.project_members m where m.project_id = progress_measurements.project_id and m.user_id = (select auth.uid()) and m.role='editor'));

create table if not exists public.equipment_shipments (id text primary key, project_id text not null, source_file text, payload jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists equipment_shipments_project_idx on public.equipment_shipments(project_id);
alter table public.equipment_shipments enable row level security;
revoke all on public.equipment_shipments from public, anon, authenticated;
grant select,insert on public.equipment_shipments to authenticated;
grant update on public.equipment_shipments to authenticated;
create trigger immutable_project_identity before update on public.equipment_shipments for each row execute function public.keep_project_data_identity();
create policy "member boundary" on public.equipment_shipments as restrictive for all to authenticated
 using (exists (select 1 from public.project_members m where m.project_id = equipment_shipments.project_id and m.user_id = (select auth.uid())))
 with check (exists (select 1 from public.project_members m where m.project_id = equipment_shipments.project_id and m.user_id = (select auth.uid())));
create policy "member read" on public.equipment_shipments for select to authenticated
 using (exists (select 1 from public.project_members m where m.project_id = equipment_shipments.project_id and m.user_id = (select auth.uid())));
create policy "editor insert" on public.equipment_shipments for insert to authenticated
 with check (exists (select 1 from public.project_members m where m.project_id = equipment_shipments.project_id and m.user_id = (select auth.uid()) and m.role='editor'));
create policy "editor update" on public.equipment_shipments for update to authenticated
 using (exists (select 1 from public.project_members m where m.project_id = equipment_shipments.project_id and m.user_id = (select auth.uid()) and m.role='editor'))
 with check (exists (select 1 from public.project_members m where m.project_id = equipment_shipments.project_id and m.user_id = (select auth.uid()) and m.role='editor'));

create table if not exists public.crosswalk_mappings (id text primary key, project_id text not null, source_file text, payload jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists crosswalk_mappings_project_idx on public.crosswalk_mappings(project_id);
alter table public.crosswalk_mappings enable row level security;
revoke all on public.crosswalk_mappings from public, anon, authenticated;
grant select,insert on public.crosswalk_mappings to authenticated;
grant update on public.crosswalk_mappings to authenticated;
create trigger immutable_project_identity before update on public.crosswalk_mappings for each row execute function public.keep_project_data_identity();
create policy "member boundary" on public.crosswalk_mappings as restrictive for all to authenticated
 using (exists (select 1 from public.project_members m where m.project_id = crosswalk_mappings.project_id and m.user_id = (select auth.uid())))
 with check (exists (select 1 from public.project_members m where m.project_id = crosswalk_mappings.project_id and m.user_id = (select auth.uid())));
create policy "member read" on public.crosswalk_mappings for select to authenticated
 using (exists (select 1 from public.project_members m where m.project_id = crosswalk_mappings.project_id and m.user_id = (select auth.uid())));
create policy "editor insert" on public.crosswalk_mappings for insert to authenticated
 with check (exists (select 1 from public.project_members m where m.project_id = crosswalk_mappings.project_id and m.user_id = (select auth.uid()) and m.role='editor'));
create policy "editor update" on public.crosswalk_mappings for update to authenticated
 using (exists (select 1 from public.project_members m where m.project_id = crosswalk_mappings.project_id and m.user_id = (select auth.uid()) and m.role='editor'))
 with check (exists (select 1 from public.project_members m where m.project_id = crosswalk_mappings.project_id and m.user_id = (select auth.uid()) and m.role='editor'));
commit;
alter table public.daily_reports enable row level security;
revoke all on public.daily_reports from public, anon, authenticated;
grant select,insert,update on public.daily_reports to authenticated;
create policy "project member records" on public.daily_reports for all to authenticated
 using (exists (select 1 from public.project_members m where m.project_id=daily_reports.project_id and m.user_id=(select auth.uid())))
 with check (exists (select 1 from public.project_members m where m.project_id=daily_reports.project_id and m.user_id=(select auth.uid()) and m.role='editor'));
alter table public.image_evidence enable row level security;
revoke all on public.image_evidence from public, anon, authenticated;
grant select,insert,update on public.image_evidence to authenticated;
create policy "project member records" on public.image_evidence for all to authenticated
 using (exists (select 1 from public.project_members m where m.project_id=image_evidence.project_id and m.user_id=(select auth.uid())))
 with check (exists (select 1 from public.project_members m where m.project_id=image_evidence.project_id and m.user_id=(select auth.uid()) and m.role='editor'));
alter table public.import_audits enable row level security;
revoke all on public.import_audits from public, anon, authenticated;
grant select,insert,update on public.import_audits to authenticated;
create policy "project member records" on public.import_audits for all to authenticated
 using (exists (select 1 from public.project_members m where m.project_id=import_audits.project_id and m.user_id=(select auth.uid())))
 with check (exists (select 1 from public.project_members m where m.project_id=import_audits.project_id and m.user_id=(select auth.uid()) and m.role='editor'));
insert into storage.buckets(id,name,public) values('khayrat-reports','khayrat-reports',false) on conflict(id) do nothing;
-- First path segment is the project ID; existing khayrat/<import>/<file> paths remain valid.
-- Restrictive policy intersects existing owner policies; it never widens access by itself.
create policy "project member storage boundary" on storage.objects as restrictive for all to authenticated
 using (bucket_id <> 'khayrat-reports' or exists (select 1 from public.project_members m where m.project_id=split_part(name,'/',1) and m.user_id=(select auth.uid())))
 with check (bucket_id <> 'khayrat-reports' or exists (select 1 from public.project_members m where m.project_id=split_part(name,'/',1) and m.user_id=(select auth.uid()) and m.role='editor'));
create policy "member storage operations" on storage.objects for all to authenticated
 using (bucket_id='khayrat-reports' and exists(select 1 from public.project_members m where m.project_id=split_part(name,'/',1) and m.user_id=(select auth.uid())))
 with check (bucket_id='khayrat-reports' and exists(select 1 from public.project_members m where m.project_id=split_part(name,'/',1) and m.user_id=(select auth.uid()) and m.role='editor'));
-- The application has no object deletion flow; keep source PDFs/evidence undeletable by clients.
create policy "project source objects retained" on storage.objects as restrictive for delete to authenticated
 using (bucket_id <> 'khayrat-reports');
