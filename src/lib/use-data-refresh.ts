"use client";

import { useEffect } from "react";
import { DATA_CHANGED_EVENT } from "@/lib/data-events";

export function useDataRefresh(load: () => void) {
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, onChange);
  }, [load]);
}
