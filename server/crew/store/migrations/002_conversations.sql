-- server/crew/store/migrations/002_conversations.sql
-- Conversations, the record of what was said in them, and a world's settings.

create table settings (
  world_id   text primary key,
  autonomy   text not null default 'autonomous'
    constraint settings_autonomy_check check (autonomy in ('ask', 'workspace', 'autonomous')),
  updated_at timestamptz not null default now()
);

create table conversations (
  id             uuid primary key default uuidv7(),
  world_id       text not null,
  agent_id       uuid not null references agents (id),
  workspace_id   uuid not null references workspaces (id),
  kind           text not null default 'task'
    constraint conversations_kind_check check (kind in ('task', 'channel')),
  title          text not null default '',
  -- The runtime's own name for this conversation, for continuing it. Nothing else reads it.
  handle         text,
  predecessor_id uuid references conversations (id),
  created_at     timestamptz not null default now(),
  closed_at      timestamptz
);

-- An agent is doing one thing at a time.
create unique index conversations_open_task_key on conversations (world_id, agent_id)
  where kind = 'task' and closed_at is null;
create index conversations_agent_idx on conversations (world_id, agent_id, created_at desc);

-- One row per world, holding the number of its latest event. Taking the next number locks
-- the row until the event is committed, which is what keeps the numbers gap free and in the
-- order the events became visible. A sequence would promise neither.
create table event_counters (
  world_id text primary key,
  seq      bigint not null
);

create table events (
  world_id        text not null,
  seq             bigint not null,
  conversation_id uuid not null references conversations (id),
  agent_id        uuid not null,
  type            text not null,
  -- The agent's status once this had happened. Status is never written anywhere else.
  status          text not null
    constraint events_status_check check (status in ('idle', 'working', 'waiting', 'failed')),
  data            jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  primary key (world_id, seq)
);

create index events_conversation_idx on events (conversation_id, seq);
