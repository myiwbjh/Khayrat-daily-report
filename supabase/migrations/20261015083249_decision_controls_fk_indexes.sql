create index if not exists equipment_batch_controls_updated_by_idx
  on public.equipment_batch_controls(updated_by);

create index if not exists risk_actions_updated_by_idx
  on public.risk_actions(updated_by);
