-- Incremental only. Preserves every existing report, image and progress row.
begin;

create table if not exists public.progress_import_batches (
  id text primary key,
  project_id text not null check (project_id ~ '^[a-z][a-z0-9_-]*$'),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  source_file text not null,
  original_object_path text,
  current_version boolean not null default false,
  plan_version text,
  plan_sheet text,
  actual_sheet text,
  quality_status text not null default 'To Be Verified'
    check (quality_status in ('Verified','To Be Verified','Rejected')),
  import_status text not null default 'importing'
    check (import_status in ('importing','complete','failed')),
  metadata jsonb not null default '{}'::jsonb,
  imported_by uuid not null default auth.uid() references auth.users(id),
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,file_hash)
);
create index if not exists progress_import_batches_current_idx
  on public.progress_import_batches(project_id,current_version,imported_at desc);

alter table public.progress_measurements
  add column if not exists import_batch_id text,
  add column if not exists file_hash text,
  add column if not exists plan_version text,
  add column if not exists snapshot_role text,
  add column if not exists period_end date,
  add column if not exists wbs_code text,
  add column if not exists discipline text,
  add column if not exists current_version boolean not null default true;

do $$ begin
  alter table public.progress_measurements add constraint progress_measurements_batch_fk
    foreign key(import_batch_id) references public.progress_import_batches(id);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.progress_measurements add constraint progress_measurements_snapshot_role_check
    check (snapshot_role is null or snapshot_role in ('current','historical-plan'));
exception when duplicate_object then null;
end $$;
create index if not exists progress_measurements_batch_idx
  on public.progress_measurements(project_id,import_batch_id,snapshot_role,period_end);
create index if not exists progress_measurements_wbs_idx
  on public.progress_measurements(project_id,wbs_code,period_end);

alter table public.progress_import_batches enable row level security;
revoke all on public.progress_import_batches from public,anon,authenticated;
grant select,insert,update on public.progress_import_batches to authenticated;

create policy "progress batch member boundary" on public.progress_import_batches
  as restrictive for all to authenticated
  using (exists (select 1 from public.project_members m where m.project_id=progress_import_batches.project_id and m.user_id=(select auth.uid())))
  with check (exists (select 1 from public.project_members m where m.project_id=progress_import_batches.project_id and m.user_id=(select auth.uid())));
create policy "progress batch member read" on public.progress_import_batches
  for select to authenticated
  using (exists (select 1 from public.project_members m where m.project_id=progress_import_batches.project_id and m.user_id=(select auth.uid())));
create policy "progress batch editor insert" on public.progress_import_batches
  for insert to authenticated
  with check (imported_by=(select auth.uid()) and exists (select 1 from public.project_members m where m.project_id=progress_import_batches.project_id and m.user_id=(select auth.uid()) and m.role='editor'));
create policy "progress batch editor update" on public.progress_import_batches
  for update to authenticated
  using (exists (select 1 from public.project_members m where m.project_id=progress_import_batches.project_id and m.user_id=(select auth.uid()) and m.role='editor'))
  with check (exists (select 1 from public.project_members m where m.project_id=progress_import_batches.project_id and m.user_id=(select auth.uid()) and m.role='editor'));

create function public.keep_progress_batch_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.id is distinct from old.id or new.project_id is distinct from old.project_id
     or new.file_hash is distinct from old.file_hash or new.imported_by is distinct from old.imported_by then
    raise exception 'progress import identity is immutable' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.keep_progress_batch_identity() from public,anon,authenticated;
create trigger immutable_progress_batch_identity before update on public.progress_import_batches
  for each row execute function public.keep_progress_batch_identity();

commit;
