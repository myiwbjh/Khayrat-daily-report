begin;

create table public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null check (length(trim(name)) between 1 and 120),
  milestone_date date not null,
  date_precision text not null default 'day' check (date_precision in ('day','month')),
  description text not null default '' check (length(description) <= 500),
  sort_order integer not null default 0 check (sort_order between 0 and 100000),
  circle_color text not null default '#168b82' check (circle_color ~ '^#[0-9A-Fa-f]{6}$'),
  before_line_style text not null default 'solid' check (before_line_style in ('solid','dashed')),
  before_line_color text not null default '#168b82' check (before_line_color ~ '^#[0-9A-Fa-f]{6}$'),
  after_line_style text not null default 'solid' check (after_line_style in ('solid','dashed')),
  after_line_color text not null default '#168b82' check (after_line_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index project_milestones_project_date_idx on public.project_milestones(project_id,milestone_date,sort_order) where deleted_at is null;

create table public.project_milestone_audits (
  id bigint generated always as identity primary key,
  project_id text not null,
  milestone_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  before_value jsonb,
  after_value jsonb,
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);
create index project_milestone_audits_project_idx on public.project_milestone_audits(project_id,changed_at desc);

alter table public.project_milestones enable row level security;
alter table public.project_milestone_audits enable row level security;
revoke all on public.project_milestones from public,anon,authenticated;
revoke all on public.project_milestone_audits from public,anon,authenticated;
grant select,insert,update,delete on public.project_milestones to authenticated;
grant select on public.project_milestone_audits to authenticated;

create policy "milestone member read" on public.project_milestones for select to authenticated
 using (exists (select 1 from public.project_members m where m.project_id=project_milestones.project_id and m.user_id=(select auth.uid())));
create policy "milestone editor insert" on public.project_milestones for insert to authenticated
 with check (exists (select 1 from public.project_members m where m.project_id=project_milestones.project_id and m.user_id=(select auth.uid()) and (m.role='editor' or m.is_admin)));
create policy "milestone editor update" on public.project_milestones for update to authenticated
 using (exists (select 1 from public.project_members m where m.project_id=project_milestones.project_id and m.user_id=(select auth.uid()) and (m.role='editor' or m.is_admin)))
 with check (exists (select 1 from public.project_members m where m.project_id=project_milestones.project_id and m.user_id=(select auth.uid()) and (m.role='editor' or m.is_admin)));
create policy "milestone editor delete" on public.project_milestones for delete to authenticated
 using (exists (select 1 from public.project_members m where m.project_id=project_milestones.project_id and m.user_id=(select auth.uid()) and (m.role='editor' or m.is_admin)));
create policy "milestone audit member read" on public.project_milestone_audits for select to authenticated
 using (exists (select 1 from public.project_members m where m.project_id=project_milestone_audits.project_id and m.user_id=(select auth.uid())));

create schema if not exists private;
create function private.audit_project_milestone() returns trigger
 language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
  if tg_op='INSERT' then
    insert into public.project_milestone_audits(project_id,milestone_id,action,after_value,changed_by)
      values(new.project_id,new.id,'insert',to_jsonb(new),(select auth.uid()));
    return new;
  elsif tg_op='UPDATE' then
    new.updated_at=now();
    insert into public.project_milestone_audits(project_id,milestone_id,action,before_value,after_value,changed_by)
      values(new.project_id,new.id,case when new.deleted_at is not null and old.deleted_at is null then 'delete' else 'update' end,to_jsonb(old),to_jsonb(new),(select auth.uid()));
    return new;
  end if;
  insert into public.project_milestone_audits(project_id,milestone_id,action,before_value,changed_by)
    values(old.project_id,old.id,'delete',to_jsonb(old),(select auth.uid()));
  return old;
end $$;
revoke all on schema private from public,anon,authenticated;
revoke all on function private.audit_project_milestone() from public,anon,authenticated;

insert into public.project_milestones(id,project_id,name,milestone_date,date_precision,description,sort_order,circle_color,before_line_style,before_line_color,after_line_style,after_line_color)
values
 ('00000000-0000-4000-8000-000000000101','khayrat','实际现场施工起点','2026-03-01','month','',10,'#168b82','solid','#168b82','solid','#168b82'),
 ('00000000-0000-4000-8000-000000000102','khayrat','合同工期起算','2026-09-07','day','',20,'#4c7fa0','solid','#168b82','dashed','#bdc8cc'),
 ('00000000-0000-4000-8000-000000000103','khayrat','主要设备安装目标','2026-12-01','month','',30,'#e89245','dashed','#bdc8cc','dashed','#bdc8cc')
on conflict(id) do nothing;

create trigger audit_project_milestone before insert or update or delete on public.project_milestones
 for each row execute function private.audit_project_milestone();

commit;
