-- The secret is provisioned separately in Vault and Production, never in Git.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('khayrat-vision-worker','* * * * *',$job$
 select net.http_post(
   url:='https://myiwbjh.vercel.app/api/vision-worker',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||s.decrypted_secret),
   body:='{}'::jsonb,timeout_milliseconds:=180000)
 from vault.decrypted_secrets s where s.name='khayrat_vision_worker'
 and exists(select 1 from public.vision_runs where project_id='khayrat' and (state='pending' or (state='running' and updated_at<now()-interval '5 minutes')));
$job$);
