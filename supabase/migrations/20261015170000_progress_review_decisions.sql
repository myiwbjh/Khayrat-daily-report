-- Review decisions stay in batch metadata; source measurements and original files remain immutable.
begin;

drop policy if exists "progress batch editor update" on public.progress_import_batches;
create policy "progress batch editor update" on public.progress_import_batches
  for update to authenticated
  using (exists (
    select 1 from public.project_members m
    where m.project_id=progress_import_batches.project_id
      and m.user_id=(select auth.uid())
      and (m.role='editor' or m.is_admin)
  ))
  with check (exists (
    select 1 from public.project_members m
    where m.project_id=progress_import_batches.project_id
      and m.user_id=(select auth.uid())
      and (m.role='editor' or m.is_admin)
  ));

drop policy if exists "project editor insert" on public.import_audits;
create policy "project editor insert" on public.import_audits
  for insert to authenticated
  with check (exists (
    select 1 from public.project_members m
    where m.project_id=import_audits.project_id
      and m.user_id=(select auth.uid())
      and (m.role='editor' or m.is_admin)
  ));

drop policy if exists "project write boundary" on public.import_audits;
create policy "project write boundary" on public.import_audits
  as restrictive for insert to authenticated
  with check (exists (
    select 1 from public.project_members m
    where m.project_id=import_audits.project_id
      and m.user_id=(select auth.uid())
      and (m.role='editor' or m.is_admin)
  ));

commit;
