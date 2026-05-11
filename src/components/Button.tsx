import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonTone = "accent" | "success";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  hint?: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Only meaningful when variant="primary". Default "accent". */
  tone?: ButtonTone;
  loading?: boolean;
  fullWidth?: boolean;
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-9 px-3 rounded-md text-footnote",
  md: "h-11 px-4 rounded-md text-footnote",
  lg: "h-[50px] px-5 rounded-lg text-subhead",
};

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "",
  secondary:
    "bg-surface text-ink border border-line shadow-elev-1 hover:bg-surface-quiet",
  ghost:
    "bg-transparent text-ink-soft hover:bg-[color-mix(in_srgb,var(--color-ink)_6%,transparent)]",
  destructive:
    "bg-danger text-white shadow-button-danger hover:bg-danger-hover",
};

const PRIMARY_TONE_CLASS: Record<ButtonTone, string> = {
  accent: "bg-accent text-white shadow-button-primary hover:bg-accent-hover",
  success:
    "bg-success text-white shadow-button-success hover:bg-success-hover",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

export function Button({
  label,
  hint,
  icon,
  variant = "primary",
  size = "md",
  tone = "accent",
  loading = false,
  fullWidth = false,
  className = "",
  disabled,
  type = "button",
  ...rest
}: Props) {
  const variantClass =
    variant === "primary" ? PRIMARY_TONE_CLASS[tone] : VARIANT_CLASS[variant];
  const hintColor =
    variant === "primary" || variant === "destructive"
      ? "text-white/85"
      : "text-ink-muted";
  return (
    <button
      type={type}
      {...rest}
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center gap-2 font-semibold",
        "transition-[background-color,box-shadow,color] duration-fast ease-standard",
        "disabled:cursor-not-allowed disabled:opacity-[var(--opacity-disabled)]",
        SIZE_CLASS[size],
        variantClass,
        fullWidth ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {(icon || loading) && (
        <span
          className={["inline-flex items-center justify-center", ICON_SIZE[size]].join(" ")}
          aria-hidden="true"
        >
          {loading ? <Loader2 className={[ICON_SIZE[size], "animate-spin"].join(" ")} /> : icon}
        </span>
      )}
      <span className="flex flex-col items-start leading-tight">
        <span>{label}</span>
        {hint ? (
          <span className={["text-caption1 font-normal", hintColor].join(" ")}>{hint}</span>
        ) : null}
      </span>
    </button>
  );
}
