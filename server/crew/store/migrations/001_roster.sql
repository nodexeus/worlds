-- server/crew/store/migrations/001_roster.sql
-- The roster and the workspaces. Every row belongs to a world.

create table agents (
  id          uuid primary key default uuidv7(),
  world_id    text not null,
  name        text not null,
  kind        text not null constraint agents_kind_check check (kind in ('unit', 'rock')),
  runtime     text not null,
  role        text not null default '',
  template_id text,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz
);

-- A retired agent gives its name back, so both rules apply to the living only.
create unique index agents_name_key on agents (world_id, lower(name)) where retired_at is null;
create unique index agents_template_key on agents (world_id, template_id)
  where template_id is not null and retired_at is null;
create index agents_world_idx on agents (world_id, created_at);

create table workspaces (
  id          uuid primary key default uuidv7(),
  world_id    text not null,
  name        text not null,
  description text not null default '',
  git_url     text,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create unique index workspaces_name_key on workspaces (world_id, lower(name)) where archived_at is null;
create index workspaces_world_idx on workspaces (world_id, created_at);
