-- server/crew/store/migrations/003_channel.sql
-- The crew channel: a post to the crew, who it went to and what each said, and who took it.

-- How many agents answer a post that names nobody. Null is all of them.
alter table settings add column channel_limit int
  constraint settings_channel_limit_check check (channel_limit between 1 and 50);

create table channel_posts (
  id         uuid primary key default uuidv7(),
  world_id   text not null,
  text       text not null,
  -- Whether it named the agents it was for. A post that named nobody went to whoever was free.
  named      boolean not null default false,
  created_at timestamptz not null default now()
);

create index channel_posts_world_idx on channel_posts (world_id, id desc);

-- An agent answers a post in a conversation of its own, which is in no workspace unless the
-- agent happened to be in one. A task still always has a workspace.
alter table conversations alter column workspace_id drop not null;
alter table conversations add column post_id uuid references channel_posts (id);
alter table conversations add constraint conversations_place_check
  check (kind = 'channel' or workspace_id is not null);

-- One row for each agent a post concerned: what became of the post for that agent.
create table channel_deliveries (
  world_id        text not null,
  post_id         uuid not null references channel_posts (id),
  agent_id        uuid not null references agents (id),
  state           text not null
    constraint channel_deliveries_state_check
    check (state in ('queued', 'answering', 'replied', 'passed', 'claimed', 'failed', 'skipped')),
  -- Why it was skipped, why it passed, or what went wrong.
  reason          text,
  text            text not null default '',
  conversation_id uuid references conversations (id),
  updated_at      timestamptz not null default now(),
  primary key (post_id, agent_id)
);

create index channel_deliveries_agent_idx on channel_deliveries (world_id, agent_id, state);

create table channel_claims (
  id              uuid primary key default uuidv7(),
  world_id        text not null,
  post_id         uuid not null references channel_posts (id),
  agent_id        uuid not null references agents (id),
  workspace_id    uuid not null references workspaces (id),
  -- The task the claim became, once it has started.
  conversation_id uuid references conversations (id),
  reason          text,
  granted_at      timestamptz not null default now(),
  released_at     timestamptz
);

-- The referee: whatever arrives together, one agent holds a post.
create unique index channel_claims_granted_key on channel_claims (post_id) where released_at is null;
create index channel_claims_post_idx on channel_claims (post_id, granted_at desc);

-- The record now also says what happens to a post, which no agent did and no conversation
-- holds. An event is about a conversation, a post, or both: an agent answering a post.
alter table events alter column conversation_id drop not null;
alter table events alter column agent_id drop not null;
alter table events alter column status drop not null;
alter table events add column post_id uuid references channel_posts (id);
alter table events add constraint events_subject_check
  check (conversation_id is not null or post_id is not null);
