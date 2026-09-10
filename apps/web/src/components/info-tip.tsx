import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Replaces ambient hint copy: a small info icon the user can hover (or
 * focus) to read the explanation. Keyboard and touch users get the same
 * text via the tooltip; screen readers announce the text on focus.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={text}
        className="inline-flex shrink-0 cursor-help items-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        type="button"
      >
        <InfoIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-start leading-5">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
