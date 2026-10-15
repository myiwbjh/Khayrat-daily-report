create table if not exists public.equipment_batch_controls (
  id text primary key,
  project_id text not null check (project_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  batch_name text not null check (char_length(batch_name) between 1 and 160),
  shipping_date date, eta date, arrival_date date, site_arrival_date date,
  customs_status text check (char_length(customs_status) <= 160),
  status text not null default 'planned' check (status in ('planned','shipping','port','customs','site','ready','blocked')),
  installation_area text check (char_length(installation_area) <= 240),
  linked_wbs text[] not null default '{}', linked_workshops text[] not null default '{}',
  responsible text check (char_length(responsible) <= 160), due_date date,
  note text check (char_length(note) <= 4000), history jsonb not null default '[]'::jsonb check (jsonb_typeof(history)='array'),
  updated_by uuid references auth.users(id) default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id,batch_name)
);
create table if not exists public.risk_actions (
  id text primary key,
  project_id text not null check (project_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  source_key text, title text check (char_length(title) <= 500), category text check (char_length(category) <= 120), scope text check (char_length(scope) <= 240),
  owner text check (char_length(owner) <= 160), due_date date,
  status text not null default 'open' check (status in ('open','monitoring','closed')),
  response text check (char_length(response) <= 4000), closure_note text check (char_length(closure_note) <= 4000),
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history)='array'), closed_at timestamptz,
  updated_by uuid references auth.users(id) default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists equipment_batch_controls_project_batch_idx on public.equipment_batch_controls(project_id,batch_name);
create index if not exists risk_actions_project_status_due_idx on public.risk_actions(project_id,status,due_date);

revoke all on public.equipment_batch_controls, public.risk_actions from public, anon, authenticated;
grant select, insert, update on public.equipment_batch_controls, public.risk_actions to authenticated;
grant all on public.equipment_batch_controls, public.risk_actions to service_role;
alter table public.equipment_batch_controls enable row level security;
alter table public.risk_actions enable row level security;

create policy equipment_controls_member_read on public.equipment_batch_controls for select to authenticated using (
  exists(select 1 from public.project_members pm where pm.project_id=equipment_batch_controls.project_id and pm.user_id=(select auth.uid()))
);
create policy equipment_controls_editor_insert on public.equipment_batch_controls for insert to authenticated with check (
  exists(select 1 from public.project_members pm where pm.project_id=equipment_batch_controls.project_id and pm.user_id=(select auth.uid()) and (pm.role='editor' or pm.is_admin))
);
create policy equipment_controls_editor_update on public.equipment_batch_controls for update to authenticated using (
  exists(select 1 from public.project_members pm where pm.project_id=equipment_batch_controls.project_id and pm.user_id=(select auth.uid()) and (pm.role='editor' or pm.is_admin))
) with check (
  exists(select 1 from public.project_members pm where pm.project_id=equipment_batch_controls.project_id and pm.user_id=(select auth.uid()) and (pm.role='editor' or pm.is_admin))
);
create policy risk_actions_member_read on public.risk_actions for select to authenticated using (
  exists(select 1 from public.project_members pm where pm.project_id=risk_actions.project_id and pm.user_id=(select auth.uid()))
);
create policy risk_actions_editor_insert on public.risk_actions for insert to authenticated with check (
  exists(select 1 from public.project_members pm where pm.project_id=risk_actions.project_id and pm.user_id=(select auth.uid()) and (pm.role='editor' or pm.is_admin))
);
create policy risk_actions_editor_update on public.risk_actions for update to authenticated using (
  exists(select 1 from public.project_members pm where pm.project_id=risk_actions.project_id and pm.user_id=(select auth.uid()) and (pm.role='editor' or pm.is_admin))
) with check (
  exists(select 1 from public.project_members pm where pm.project_id=risk_actions.project_id and pm.user_id=(select auth.uid()) and (pm.role='editor' or pm.is_admin))
);
