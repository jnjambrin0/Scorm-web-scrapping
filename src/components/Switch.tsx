import { useId } from "react";

interface Props {
  label: string;
  /** Optional help text rendered below the row (replaces the old tooltip pattern). */
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, hint, checked, onChange, disabled }: Props) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="block">
      <div className="surface-quiet flex items-center justify-between gap-3 rounded-md px-3.5 py-2.5">
        <label
          htmlFor={id}
          className={[
            "text-footnote font-medium",
            disabled ? "text-ink-faint" : "text-ink cursor-pointer",
          ].join(" ")}
        >
          {label}
        </label>
        <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            aria-checked={checked}
            aria-describedby={hint ? hintId : undefined}
            className="peer absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
          />
          <span
            aria-hidden="true"
            className={[
              "h-6 w-11 rounded-full transition-colors duration-fast ease-standard",
              checked ? "bg-accent" : "bg-line",
              disabled ? "opacity-[var(--opacity-disabled)]" : "",
              "peer-focus-visible:shadow-[var(--shadow-focus-ring)]",
            ].join(" ")}
          />
          <span
            aria-hidden="true"
            className={[
              "pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-elev-1 transition-transform duration-fast ease-standard",
              checked ? "translate-x-5" : "translate-x-0",
            ].join(" ")}
          />
        </span>
      </div>
      {hint ? (
        <p id={hintId} className="mt-1.5 px-1 text-caption1 leading-snug text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
