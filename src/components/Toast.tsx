import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { useT } from "../lib/i18n-context";

export type ToastTone = "info" | "success" | "warning" | "danger" | "loading";

interface Props {
  tone: ToastTone;
  title: string;
  description?: string;
  technicalDetails?: string;
  /** Optional action button (e.g. Cancel). */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss after N ms. 0 disables auto-dismiss. Default 0 for warning/danger/loading, 8000 for info/success. */
  autoDismissMs?: number;
  onClose?: () => void;
}

const TONE_CLASS: Record<ToastTone, string> = {
  info: "surface-tint-info",
  success: "surface-tint-success",
  warning: "surface-tint-warning",
  danger: "surface-tint-danger",
  loading: "surface-elevated",
};

const TONE_ICON: Record<
  ToastTone,
  { Icon: typeof Info; className: string; spin?: boolean }
> = {
  info: { Icon: Info, className: "text-accent" },
  success: { Icon: CheckCircle2, className: "text-success" },
  warning: { Icon: AlertTriangle, className: "text-warning" },
  danger: { Icon: XCircle, className: "text-danger" },
  loading: { Icon: Loader2, className: "text-accent", spin: true },
};

function defaultDismissMs(tone: ToastTone): number {
  if (tone === "info" || tone === "success") return 8000;
  return 0;
}

export function Toast({
  tone,
  title,
  description,
  technicalDetails,
  action,
  autoDismissMs,
  onClose,
}: Props) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const dismissMs = autoDismissMs ?? defaultDismissMs(tone);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!dismissMs || paused || !onClose) return;
    const timer = window.setTimeout(() => onCloseRef.current?.(), dismissMs);
    return () => window.clearTimeout(timer);
  }, [dismissMs, paused, onClose]);

  const role = tone === "danger" || tone === "warning" ? "alert" : "status";
  const live = tone === "danger" || tone === "warning" ? "assertive" : "polite";
  const visual = TONE_ICON[tone];
  const VisualIcon = visual.Icon;

  return (
    <div
      role={role}
      aria-live={live}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      data-enter="toast"
      className={[
        "fixed z-[var(--z-toast)] rounded-xl",
        "top-[calc(env(safe-area-inset-top,0px)+72px)]",
        "right-4 sm:right-6",
        "left-4 sm:left-auto",
        "sm:max-w-[400px] sm:w-auto",
        "p-4",
        TONE_CLASS[tone],
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center">
          <VisualIcon
            className={[
              "h-5 w-5",
              visual.className,
              visual.spin ? "animate-spin" : "",
            ].join(" ")}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-footnote font-semibold text-ink">{title}</p>
          {description ? (
            <p className="mt-1 text-caption1 leading-snug text-ink-soft">{description}</p>
          ) : null}

          {technicalDetails ? (
            <ToastDetails
              text={technicalDetails}
              open={detailsOpen}
              onToggle={() => setDetailsOpen((v) => !v)}
              showLabel={t("result.showDetails")}
              hideLabel={t("result.hideDetails")}
            />
          ) : null}

          {action ? (
            <button
              type="button"
              onClick={action.onClick}
              className="mt-3 inline-flex h-8 items-center justify-center rounded-md border border-line bg-surface px-3 text-caption1 font-medium text-ink transition-colors duration-fast ease-standard hover:bg-surface-quiet"
            >
              {action.label}
            </button>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("toast.dismiss")}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-fast ease-standard hover:bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface DetailsProps {
  text: string;
  open: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}

function ToastDetails({ text, open, onToggle, showLabel, hideLabel }: DetailsProps) {
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-caption1 font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        {open ? hideLabel : showLabel}
      </button>
      {open ? (
        <pre className="scrollbar-quiet mt-2 max-h-40 overflow-auto rounded-md border border-line bg-log-bg p-2 font-mono text-mono text-log-text">
          {text}
        </pre>
      ) : null}
    </div>
  );
}
