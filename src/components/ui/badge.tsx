import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/15 text-primary dark:bg-primary/25 dark:text-primary",
        secondary:
          "border border-border/60 bg-white/80 text-foreground dark:border-white/15 dark:bg-white/12 dark:text-foreground",
        outline: "border border-border/70 bg-white/70 text-foreground dark:bg-white/10",
        success:
          "border-transparent bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
        warning:
          "border-transparent bg-amber-500/15 text-amber-900 dark:text-amber-200",
        danger:
          "border-transparent bg-rose-500/15 text-rose-800 dark:text-rose-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
