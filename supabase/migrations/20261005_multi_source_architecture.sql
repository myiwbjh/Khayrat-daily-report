create table if not exists public.progress_measurements (id text primary key, project_id text not null default 'khayrat', source_file text, payload jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.equipment_shipments (id text primary key, project_id text not null default 'khayrat', source_file text, payload jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.crosswalk_mappings (id text primary key, project_id text not null default 'khayrat', source_file text, payload jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists progress_measurements_project_idx on public.progress_measurements(project_id);
create index if not exists equipment_shipments_project_idx on public.equipment_shipments(project_id);
create index if not exists crosswalk_mappings_project_idx on public.crosswalk_mappings(project_id);
alter table public.progress_measurements enable row level security;
alter table public.equipment_shipments enable row level security;
alter table public.crosswalk_mappings enable row level security;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='progress_measurements' and policyname='authenticated progress') then create policy "authenticated progress" on public.progress_measurements for all to authenticated using (true) with check (true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='equipment_shipments' and policyname='authenticated shipments') then create policy "authenticated shipments" on public.equipment_shipments for all to authenticated using (true) with check (true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='crosswalk_mappings' and policyname='authenticated mappings') then create policy "authenticated mappings" on public.crosswalk_mappings for all to authenticated using (true) with check (true); end if;
end $$;
grant select,insert,update,delete on public.progress_measurements,public.equipment_shipments,public.crosswalk_mappings to authenticated;
