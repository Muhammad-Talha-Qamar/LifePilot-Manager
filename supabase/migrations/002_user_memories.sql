-- Persistent AI memories (preferences + context notes). Not a substitute for tasks/events.
-- Task status and other application data remain in their own tables.

create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null
    check (category in ('preference', 'context')),
  key text,
  content text not null check (char_length(content) between 1 and 500),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per stable key per user when key is set
  constraint user_memories_user_key_unique unique (user_id, key)
);

create index if not exists idx_user_memories_user
  on public.user_memories(user_id);
create index if not exists idx_user_memories_user_category
  on public.user_memories(user_id, category);

create trigger user_memories_updated_at before update on public.user_memories
  for each row execute function public.set_updated_at();

alter table public.user_memories enable row level security;

create policy "Users manage own memories" on public.user_memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
