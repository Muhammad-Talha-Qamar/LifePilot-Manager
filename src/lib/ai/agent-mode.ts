/**
 * Cursor-like agent modes for LifePilot.
 *
 * - agent: full read/write tool use (default)
 * - plan: design the steps, do not change saved records
 * - ask: read-only answers from saved records
 */

export type AgentMode = "agent" | "plan" | "ask";

export const READ_TOOLS = new Set([
  "list_tasks",
  "get_task",
  "list_checklists",
  "list_events",
  "list_projects",
  "query_schedule",
  "search_records",
  "resolve_date",
  "propose_daily_plan",
  "get_productivity_summary",
  "list_memories",
]);

export const WRITE_TOOLS = new Set([
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "create_checklist",
  "update_checklist",
  "manage_checklist_items",
  "add_checklist_items",
  "complete_checklist_items",
  "delete_checklist",
  "create_project",
  "update_project",
  "delete_project",
  "move_tasks_to_project",
  "create_event",
  "update_event",
  "delete_event",
  "undo_last_change",
  "save_productivity_preference",
  "save_memory",
  "update_memory",
  "forget_memory",
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export function modeAllowsTool(mode: AgentMode, name: string): boolean {
  if (mode === "agent") return true;
  if (mode === "ask" || mode === "plan") return READ_TOOLS.has(name) || name === "resolve_date";
  return true;
}

export function modeSystemAddon(mode: AgentMode): string {
  if (mode === "ask") {
    return `## Active mode: Ask (read-only)
- Answer questions using query/search tools only.
- Never create, update, complete, delete, or undo records.
- If the user asks to change something, explain what you would do and suggest switching to Agent mode (or say “switch to Agent and ask me again”).`;
  }
  if (mode === "plan") {
    return `## Active mode: Plan
- Investigate with read-only tools if needed, then propose a clear numbered plan.
- Do NOT call any write tools. Do not change saved records.
- End with: what you will do in Agent mode, risks/ambiguities, and ask if they want you to execute.
- Keep the plan concrete (tool-level steps: create task X, complete Y, move Z).`;
  }
  return `## Active mode: Agent
- You are an autonomous productivity agent (Cursor-style). Persist until the request is fully done.
- Use tools. Prefer acting when intent is clear. Multi-step is expected.
- Show progress through tool use; summarize verified results at the end.
- For destructive deletes, confirm first.`;
}

export interface SlashResult {
  mode?: AgentMode;
  text: string;
  builtin?: "clear" | "undo" | "help" | "regenerate";
}

/** Parse leading slash commands inspired by Cursor chat. */
export function parseSlashCommand(raw: string): SlashResult {
  const trimmed = raw.trim();
  const match = trimmed.match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return { text: trimmed };

  const cmd = match[1].toLowerCase();
  const rest = (match[2] ?? "").trim();

  if (cmd === "agent" || cmd === "a") return { mode: "agent", text: rest || "Continue in agent mode." };
  if (cmd === "plan" || cmd === "p") {
    return { mode: "plan", text: rest || "Help me plan what to do next with my work." };
  }
  if (cmd === "ask" || cmd === "q") {
    return { mode: "ask", text: rest || "What should I know about my schedule today?" };
  }
  if (cmd === "undo" || cmd === "u") return { text: "undo", builtin: "undo" };
  if (cmd === "clear" || cmd === "reset") return { text: "", builtin: "clear" };
  if (cmd === "retry" || cmd === "regenerate" || cmd === "r") {
    return { text: "", builtin: "regenerate" };
  }
  if (cmd === "help" || cmd === "h" || cmd === "?") return { text: "", builtin: "help" };

  return { text: trimmed };
}

export const SLASH_HELP = [
  "Cursor-style commands:",
  "• /agent … — full agent (read + write)",
  "• /plan … — plan steps without changing data",
  "• /ask … — read-only answers",
  "• /undo — undo the last change",
  "• /retry — regenerate the last reply",
  "• /clear — clear this chat",
  "• /help — show this list",
  "",
  "You can also switch modes with the Agent / Plan / Ask controls above the composer.",
].join("\n");

/** Suggest natural follow-ups after a successful turn (Cursor-style). */
export function suggestFollowUps(input: {
  userMessage: string;
  assistantMessage: string;
  toolNames: string[];
  agentMode: AgentMode;
}): string[] {
  const tools = new Set(input.toolNames);
  const tips: string[] = [];

  if (input.agentMode === "plan") {
    tips.push("Execute this plan");
    tips.push("/agent do the first step");
    tips.push("Make the plan shorter");
    return tips.slice(0, 3);
  }
  if (input.agentMode === "ask") {
    tips.push("What's left today?");
    tips.push("How packed is this week?");
    tips.push("/agent add a reminder from that");
    return tips.slice(0, 3);
  }

  if (tools.has("create_task") || tools.has("create_checklist")) {
    tips.push("Add another related task");
    tips.push("Make that urgent");
    tips.push("What's left today?");
  } else if (tools.has("complete_task") || tools.has("complete_checklist_items")) {
    tips.push("What's still left today?");
    tips.push("Plan the rest of my day");
    tips.push("Undo that");
  } else if (tools.has("query_schedule")) {
    tips.push("Plan my day");
    tips.push("What should I work on first?");
    tips.push("What's coming up?");
    tips.push("Show overdue");
    tips.push("Remind me to review this tomorrow");
  } else if (tools.has("undo_last_change")) {
    tips.push("What's left today?");
    tips.push("Redo that change");
  } else {
    tips.push("What's left today?");
    tips.push("Plan my day");
    tips.push("What should I work on first?");
    tips.push("What's coming up?");
    tips.push("/plan organize my week");
  }

  return tips.slice(0, 3);
}

export function toolActivityLabel(name: string): string {
  const labels: Record<string, string> = {
    create_task: "Creating task",
    update_task: "Updating task",
    complete_task: "Completing task",
    delete_task: "Deleting task",
    create_checklist: "Creating checklist",
    update_checklist: "Updating checklist",
    manage_checklist_items: "Updating checklist items",
    add_checklist_items: "Adding checklist items",
    complete_checklist_items: "Completing checklist items",
    delete_checklist: "Deleting checklist",
    create_project: "Creating project",
    update_project: "Updating project",
    delete_project: "Deleting project",
    move_tasks_to_project: "Moving tasks into project",
    list_projects: "Listing projects",
    create_event: "Saving event",
    update_event: "Updating event",
    delete_event: "Deleting event",
    undo_last_change: "Undoing last change",
    query_schedule: "Checking schedule",
    search_records: "Searching records",
    list_tasks: "Listing tasks",
    list_checklists: "Listing checklists",
    list_events: "Listing events",
    get_task: "Loading task",
    resolve_date: "Resolving date",
    propose_daily_plan: "Building day plan",
    save_productivity_preference: "Saving preference",
    list_memories: "Checking memories",
    save_memory: "Saving memory",
    update_memory: "Updating memory",
    forget_memory: "Forgetting memory",
  };
  return labels[name] ?? "Working";
}
