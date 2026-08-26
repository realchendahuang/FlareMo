import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type DeployButtonProps = {
  href: string;
  children: ReactNode;
  className?: string;
  /** When true, renders the gradient brand CTA. */
  variant?: "primary" | "secondary";
};

const PRIMARY =
  "bg-brand-gradient text-primary-foreground shadow-md hover:brightness-105 active:translate-y-px";
const SECONDARY =
  "border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground";

export function DeployButton({
  href,
  children,
  className,
  variant = "primary",
}: DeployButtonProps) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all motion-safe:duration-200",
        variant === "primary" ? PRIMARY : SECONDARY,
        className,
      )}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
      <ArrowRight className="size-4" />
    </a>
  );
}

export const DEPLOY_BUTTON_URL =
  "https://deploy.workers.cloudflare.com/?url=https://github.com/realchendahuang/FlareMo";
