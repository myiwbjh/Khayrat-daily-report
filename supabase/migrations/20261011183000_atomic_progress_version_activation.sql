-- Atomically activates a fully imported progress workbook without deleting history.
begin;

create or replace function public.activate_progress_import_batch(target_project_id text,target_batch_id text)
returns void
language plpgsql
security invoker
set search_path=''
as $$
begin
  if not exists (
    select 1 from public.progress_import_batches b
    where b.id=target_batch_id and b.project_id=target_project_id and b.import_status='importing'
  ) then
    raise exception 'progress batch is not ready for activation' using errcode='22023';
  end if;

  if not exists (
    select 1 from public.progress_measurements m
    where m.import_batch_id=target_batch_id and m.project_id=target_project_id
  ) then
    raise exception 'progress batch has no validated measurements' using errcode='22023';
  end if;

  update public.progress_import_batches
  set current_version=false,updated_at=now()
  where project_id=target_project_id and current_version=true and id<>target_batch_id;

  update public.progress_import_batches
  set current_version=true,import_status='complete',updated_at=now()
  where project_id=target_project_id and id=target_batch_id;
end
$$;

revoke all on function public.activate_progress_import_batch(text,text) from public,anon;
grant execute on function public.activate_progress_import_batch(text,text) to authenticated;

commit;
