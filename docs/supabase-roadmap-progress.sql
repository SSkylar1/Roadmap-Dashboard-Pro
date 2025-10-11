-- Supabase table for roadmap manual adjustments persisted by the dashboard.
-- Run this script in the `public` schema of your Supabase project.

create table if not exists public.roadmap_manual_state (
  owner text not null,
  repo text not null,
  project_id text not null default ''::text,
  state jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (owner, repo, project_id)
);

create or replace function public.roadmap_manual_state_touch()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists roadmap_manual_state_touch on public.roadmap_manual_state;
create trigger roadmap_manual_state_touch
before update on public.roadmap_manual_state
for each row execute function public.roadmap_manual_state_touch();

alter table public.roadmap_manual_state enable row level security;

drop policy if exists "roadmap_manual_state service role" on public.roadmap_manual_state;
create policy "roadmap_manual_state service role"
  on public.roadmap_manual_state
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
