import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../lib/i18n-context";

interface Props {
  text: string;
  label?: string;
}

export function HelpTooltip({ text, label }: Props) {
  const t = useT();
  const accessibleLabel = label ?? t("common.help");
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={accessibleLabel}
        aria-expanded={open}
        aria-controls={tooltipId}
        onClick={() => setOpen((prev) => !prev)}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!containerRef.current?.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-muted transition-colors duration-fast ease-standard hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)] hover:text-ink"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!open}
        className="surface-elevated absolute right-0 top-7 z-[var(--z-tooltip)] w-[min(18rem,calc(100vw-2rem))] rounded-md px-3.5 py-2.5 text-caption1 leading-snug text-ink"
      >
        {text}
      </span>
    </span>
  );
}
