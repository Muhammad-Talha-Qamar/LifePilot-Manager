"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { AssistantProvider } from "@/components/assistant/assistant-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AssistantProvider>
        {children}
        <Toaster
          theme="system"
          richColors
          position="top-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: "animate-fade-up",
            },
          }}
        />
      </AssistantProvider>
    </ThemeProvider>
  );
}
