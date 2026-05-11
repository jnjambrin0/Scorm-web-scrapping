import { useId, type InputHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { HelpTooltip } from "./HelpTooltip";

type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value" | "size"
>;

interface Props extends InputProps {
  label: string;
  help?: string;
  helpLabel?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  size?: "md" | "lg";
  /** Inline validation error. Sets aria-invalid + red border + message below. */
  error?: string;
  /** Subtle success marker after a successful blur-validate. */
  success?: boolean;
  /** Called when input loses focus — caller runs validation. */
  onBlur?: () => void;
}

export function Field({
  label,
  help,
  helpLabel,
  value,
  onChange,
  hint,
  size = "md",
  error,
  success,
  onBlur,
  className,
  required,
  ...rest
}: Props) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const heightClass = size === "lg" ? "h-12 text-subhead" : "h-11 text-footnote";
  const hasError = !!error;
  const showSuccess = success && !hasError;
  const describedBy = hasError ? errorId : hint ? hintId : undefined;
  return (
    <div className="block">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="text-footnote font-medium text-ink"
        >
          {label}
          {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
        </label>
        {help ? <HelpTooltip text={help} label={helpLabel ?? label} /> : null}
      </div>
      <div className="relative">
        <input
          {...rest}
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          required={required}
          className={[
            heightClass,
            "w-full rounded-md border bg-surface px-3.5 text-ink",
            "transition-[border-color,box-shadow] duration-fast ease-standard",
            "placeholder:text-ink-faint",
            hasError
              ? "border-danger focus:border-danger focus:shadow-[var(--shadow-focus-ring-danger)] focus:outline-none"
              : "border-line hover:border-line-strong focus:border-accent focus:outline-none",
            "disabled:cursor-not-allowed disabled:bg-surface-quiet disabled:text-ink-muted",
            showSuccess ? "pr-9" : "",
            className ?? "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        {showSuccess ? (
          <span
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center"
            aria-hidden="true"
          >
            <Check className="h-4 w-4 text-success" />
          </span>
        ) : null}
      </div>
      {hasError ? (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-caption1 leading-snug text-danger"
        >
          {error}
        </p>
      ) : hint ? (
        <p
          id={hintId}
          className="mt-1.5 text-caption1 leading-snug text-ink-muted"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
