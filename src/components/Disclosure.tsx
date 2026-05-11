import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Disclosure({ title, subtitle, defaultOpen = false, children }: Props) {
  return (
    <details
      className="surface-quiet group rounded-lg transition-colors duration-fast ease-standard open:bg-surface"
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 text-footnote font-medium text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-4 w-4 shrink-0 text-ink-muted transition-transform duration-fast ease-standard group-open:rotate-90"
          aria-hidden="true"
        />
        <span className="flex-1 truncate">{title}</span>
        {subtitle ? (
          <span className="hidden truncate text-caption1 font-normal text-ink-muted sm:inline">
            {subtitle}
          </span>
        ) : null}
      </summary>
      <div className="px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}
