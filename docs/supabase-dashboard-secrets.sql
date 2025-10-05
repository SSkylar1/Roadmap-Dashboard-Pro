-- Dashboard secrets storage for Roadmap Dashboard Pro
create table if not exists public.dashboard_secrets (
  composite_id text primary key,
  owner text,
  repo text,
  project_id text,
  payload_encrypted text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists dashboard_secrets_owner_repo_project_idx
  on public.dashboard_secrets (coalesce(owner, ''), coalesce(repo, ''), coalesce(project_id, ''));

alter table public.dashboard_secrets enable row level security;

drop policy if exists "service-role-full-access" on public.dashboard_secrets;
create policy "service-role-full-access"
  on public.dashboard_secrets
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
