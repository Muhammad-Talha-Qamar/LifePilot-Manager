"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Remounts children on route change so page-enter runs once per navigation. */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <div key={pathname} className={cn("animate-page-enter", className)}>
      {children}
    </div>
  );
}

/** LifePilot mark: orbit + compass needle (used in AI hero & sidebar). */
export function LifePilotLogo({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      fill="none"
      aria-hidden
    >
      <circle
        cx="16"
        cy="16"
        r="11.5"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.35"
      />
      <circle
        cx="16"
        cy="16"
        r="7"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.55"
      />
      <path
        d="M16 6.5 L18.2 14.2 L25.5 16 L18.2 17.8 L16 25.5 L13.8 17.8 L6.5 16 L13.8 14.2 Z"
        fill="currentColor"
        opacity="0.95"
      />
      <circle cx="16" cy="16" r="2.25" fill="currentColor" />
      <circle cx="25.5" cy="9" r="1.6" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
