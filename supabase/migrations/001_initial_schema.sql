-- LifePilot initial schema
-- Apply in Supabase SQL editor or via `supabase db push`

create extension if not exists "pgcrypto";

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text,
  status text not null default 'active'
    check (status in ('active', 'on_hold', 'completed', 'archived')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  start_date date,
  deadline date,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  category text,
  project_id uuid references public.projects(id) on delete set null,
  is_template boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  due_date date,
  due_time time,
  category text,
  project_id uuid references public.projects(id) on delete set null,
  checklist_id uuid references public.checklists(id) on delete set null,
  tags text[] not null default '{}',
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  is_completed boolean not null default false,
  due_date date,
  position integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  location text,
  event_type text not null default 'event'
    check (event_type in ('event', 'meeting', 'appointment', 'exam', 'deadline', 'important_date')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at >= start_at)
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  remind_at timestamptz not null,
  related_type text not null default 'custom'
    check (related_type in ('task', 'event', 'checklist_item', 'project', 'custom')),
  related_id uuid,
  is_read boolean not null default false,
  is_delivered boolean not null default false,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.productivity_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  preferred_working_hours_start time,
  preferred_working_hours_end time,
  planning_style text check (planning_style in ('time_blocked', 'priority_first', 'flexible')),
  default_task_duration_minutes integer check (default_task_duration_minutes is null or default_task_duration_minutes > 0),
  timezone text not null default 'UTC',
  week_starts_on smallint not null default 1 check (week_starts_on in (0, 1)),
  reminder_lead_minutes integer not null default 60,
  categories text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_action_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tool_name text not null,
  arguments jsonb not null default '{}',
  result_summary text,
  success boolean not null,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_tasks_user_id on public.tasks(user_id);
create index if not exists idx_tasks_user_status on public.tasks(user_id, status);
create index if not exists idx_tasks_user_due on public.tasks(user_id, due_date);
create index if not exists idx_tasks_project on public.tasks(project_id);
create index if not exists idx_checklists_user on public.checklists(user_id);
create index if not exists idx_checklist_items_checklist on public.checklist_items(checklist_id);
create index if not exists idx_checklist_items_user on public.checklist_items(user_id);
create index if not exists idx_projects_user on public.projects(user_id);
create index if not exists idx_events_user_start on public.calendar_events(user_id, start_at);
create index if not exists idx_reminders_user_remind on public.reminders(user_id, remind_at);
create index if not exists idx_reminders_unread on public.reminders(user_id, is_read);

-- Auto profile + preferences on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, timezone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'timezone', 'UTC')
  );
  insert into public.productivity_preferences (user_id, timezone)
  values (new.id, coalesce(new.raw_user_meta_data->>'timezone', 'UTC'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger checklists_updated_at before update on public.checklists
  for each row execute function public.set_updated_at();
create trigger checklist_items_updated_at before update on public.checklist_items
  for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger events_updated_at before update on public.calendar_events
  for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger prefs_updated_at before update on public.productivity_preferences
  for each row execute function public.set_updated_at();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
alter table public.projects enable row level security;
alter table public.calendar_events enable row level security;
alter table public.reminders enable row level security;
alter table public.productivity_preferences enable row level security;
alter table public.ai_action_audit enable row level security;

-- Profiles policies
create policy "Users read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Generic ownership policies
create policy "Users manage own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own checklists" on public.checklists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own checklist items" on public.checklist_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own projects" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own events" on public.calendar_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own reminders" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users manage own preferences" on public.productivity_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users read own ai audit" on public.ai_action_audit
  for select using (auth.uid() = user_id);
create policy "Users insert own ai audit" on public.ai_action_audit
  for insert with check (auth.uid() = user_id);
