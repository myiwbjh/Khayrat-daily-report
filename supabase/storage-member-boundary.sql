-- REVIEW ONLY: execute separately ONLY after membership and path verification/approval.
-- First path segment is the project ID; existing khayrat/<import>/<file> paths remain valid.
-- Restrictive policy intersects existing owner policies; it never widens access by itself.
create policy "project member storage boundary" on storage.objects as restrictive for all to authenticated
 using (bucket_id <> 'khayrat-reports' or exists (select 1 from public.project_members m where m.project_id=split_part(name,'/',1) and m.user_id=(select auth.uid())))
 with check (bucket_id <> 'khayrat-reports' or exists (select 1 from public.project_members m where m.project_id=split_part(name,'/',1) and m.user_id=(select auth.uid()) and m.role='editor'));
-- The application has no object deletion flow; keep source PDFs/evidence undeletable by clients.
create policy "project source objects retained" on storage.objects as restrictive for delete to authenticated
 using (bucket_id <> 'khayrat-reports');
