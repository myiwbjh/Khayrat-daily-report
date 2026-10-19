begin;
alter table public.vision_runs drop constraint vision_runs_state_check;
alter table public.vision_runs add constraint vision_runs_state_check check(state in ('pending','running','success','failed'));
alter table public.vision_runs add column requested_by uuid references auth.users(id),
 add column consent jsonb, add column content_hash text, add column error text,
 add column started_at timestamptz, add column queued_at timestamptz default now();
create index vision_runs_hash on public.vision_runs(project_id,content_hash) where analysis is not null;
create index vision_runs_pending on public.vision_runs(queued_at) where state='pending';
revoke insert,update on public.vision_runs from authenticated;
grant all on public.vision_runs to service_role;

create function public.enqueue_vision_jobs(p_ids text[],p_user uuid,p_consent jsonb,p_retry boolean default false)
returns table(image_id text,state text,error text) language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.project_members where project_id='khayrat' and user_id=p_user and role='editor') then raise exception 'Editor required'; end if;
 if cardinality(p_ids)>100 or p_consent->>'consent' is distinct from 'true' or p_consent->>'provider' is distinct from 'groq' then raise exception 'Invalid consent'; end if;
 insert into public.vision_runs as v(image_id,project_id,state,requested_by,consent)
 select e.image_id,'khayrat','pending',p_user,p_consent from public.image_evidence e
 where e.project_id='khayrat' and e.image_id=any(p_ids) and e.payload->>'objectPath' like 'khayrat/%'
 and coalesce(e.payload->>'ignored','false')<>'true' and coalesce(e.payload->>'decorative','false')<>'true' and coalesce(e.payload->>'logoConfirmed','false')<>'true'
 on conflict on constraint vision_runs_pkey do update set state='pending',requested_by=p_user,consent=p_consent,error=null,updated_at=now(),queued_at=now()
 where v.state='failed' and p_retry;
 return query select v.image_id,v.state,v.error from public.vision_runs v where v.project_id='khayrat' and v.image_id=any(p_ids);
end $$;

create function public.claim_vision_job() returns setof public.vision_runs
language plpgsql security invoker set search_path='' as $$
declare selected_id text;
begin
 if not pg_try_advisory_xact_lock(68261019) then return; end if;
 -- Interrupted calls require explicit retry rather than silently spending again.
 update public.vision_runs set state='failed',error='后台任务中断，请手动重试',updated_at=now()
 where project_id='khayrat' and state='running' and updated_at<now()-interval '5 minutes';
 if exists(select 1 from public.vision_runs where project_id='khayrat' and (state='running' or started_at>now()-interval '61 seconds')) then return; end if;
 select v.image_id into selected_id from public.vision_runs v where v.project_id='khayrat' and v.state='pending' order by v.queued_at,v.image_id limit 1 for update skip locked;
 return query update public.vision_runs set state='running',started_at=now(),updated_at=now(),error=null where image_id=selected_id returning *;
end $$;

create function public.finish_vision_job(p_id text,p_lease timestamptz,p_analysis jsonb,p_evidence jsonb,p_hash text,p_error text,p_attempts jsonb default '[]')
returns boolean language plpgsql security invoker set search_path='' as $$
declare e jsonb; saved jsonb;
begin
 perform 1 from public.vision_runs where image_id=p_id and project_id='khayrat' and state='running' and updated_at=p_lease for update;
 if not found then return false; end if;
 select payload into e from public.image_evidence where image_id=p_id and project_id='khayrat' for update;
 if p_error is null and p_evidence is not null then
   saved=e||jsonb_build_object('analysisStatus','success','analysisError',null,'automaticAnalysis',p_evidence,'initialAnalysis',coalesce(e->'initialAnalysis',e->'automaticAnalysis',p_evidence),'imageContentHash',p_hash);
   -- Concurrent human review/calibration wins over automatic fields.
   if coalesce(e->>'manualReviewed','false')<>'true' then saved=saved||p_evidence; end if;
   update public.image_evidence set payload=saved,updated_at=now() where image_id=p_id and project_id='khayrat';
 end if;
 update public.vision_runs set state=case when p_error is null then 'success' else 'failed' end,
 analysis=coalesce(p_analysis,analysis),content_hash=coalesce(p_hash,content_hash),error=left(p_error,500),
 attempts=attempts||coalesce(p_analysis->'attempts',p_attempts,'[]'::jsonb),updated_at=now() where image_id=p_id;
 return true;
end $$;
revoke all on function public.enqueue_vision_jobs(text[],uuid,jsonb,boolean),public.claim_vision_job(),public.finish_vision_job(text,timestamptz,jsonb,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_vision_jobs(text[],uuid,jsonb,boolean),public.claim_vision_job(),public.finish_vision_job(text,timestamptz,jsonb,jsonb,text,text,jsonb) to service_role;
commit;
