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
