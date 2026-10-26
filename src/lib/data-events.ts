export const DATA_CHANGED_EVENT = "lifepilot:changed";

export function notifyDataChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}
