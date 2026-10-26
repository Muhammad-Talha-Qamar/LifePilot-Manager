import { AppShell } from "@/components/layout/app-shell";
import { isDemoMode } from "@/lib/config";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell isDemo={isDemoMode()}>{children}</AppShell>;
}
