import { useMemo } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldQuestion,
  TriangleAlert,
} from "lucide-react";
import { useT } from "../lib/i18n-context";
import type { SessionCheckStatus } from "../hooks/useSessionCheck";

export type { SessionCheckStatus };

interface Props {
  status: SessionCheckStatus;
  checkedAt: Date | null;
  /** Called when the user wants to re-run the check (idle/verified/error states). */
  onCheck: () => void;
  /** Called when the user clicks the chip in unauth state to launch the login flow. */
  onSignIn: () => void;
  /** External disable signal (e.g. another job running). Does not override built-in checking disabled. */
  disabled?: boolean;
}

type LabelKey =
  | "session.notVerified"
  | "session.checking"
  | "session.verified"
  | "session.signIn"
  | "session.error";

interface Visual {
  dot: string;
  labelKey: LabelKey;
  container: string;
  showRefreshIcon: boolean;
}

const VISUAL: Record<SessionCheckStatus, Visual> = {
  idle: {
    dot: "bg-ink-faint",
    labelKey: "session.notVerified",
    container: "surface",
    showRefreshIcon: true,
  },
  checking: {
    dot: "bg-accent animate-pulse-subtle",
    labelKey: "session.checking",
    container: "surface",
    showRefreshIcon: true,
  },
  verified: {
    dot: "bg-success",
    labelKey: "session.verified",
    container: "surface",
    showRefreshIcon: true,
  },
  unauth: {
    dot: "bg-warning",
    labelKey: "session.signIn",
    container: "surface-tint-warning",
    showRefreshIcon: false,
  },
  error: {
    dot: "bg-ink-muted",
    labelKey: "session.error",
    container: "surface",
    showRefreshIcon: true,
  },
};

export function SessionChip({ status, checkedAt, onCheck, onSignIn, disabled }: Props) {
  const t = useT();
  const visual = VISUAL[status];
  const checking = status === "checking";

  const ago = useMemo(() => {
    if (!checkedAt) return null;
    if (status !== "verified") return null;
    const minutes = Math.max(0, Math.floor((Date.now() - checkedAt.getTime()) / 60_000));
    if (minutes <= 0) return t("session.justNow");
    return t("session.minutesAgo", { n: minutes });
  }, [checkedAt, status, t]);

  const interactive = status === "unauth" ? onSignIn : onCheck;
  const ActionIcon = pickActionIcon(status);
  const ariaLabel = t(visual.labelKey);

  return (
    <button
      type="button"
      onClick={interactive}
      disabled={disabled || checking}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={[
        visual.container,
        "inline-flex items-center gap-2 rounded-full py-1 pl-2 pr-2.5",
        "transition-colors duration-fast ease-standard",
        "hover:bg-surface-quiet",
        "disabled:cursor-not-allowed disabled:opacity-[var(--opacity-disabled)]",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={["inline-block h-2 w-2 rounded-full", visual.dot].join(" ")}
      />
      <span className="text-caption1 font-medium text-ink">
        {t(visual.labelKey)}
      </span>
      {ago ? (
        <span className="text-caption2 text-ink-muted">· {ago}</span>
      ) : null}
      <span
        aria-hidden="true"
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center text-ink-muted"
      >
        {checking ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ActionIcon className="h-3.5 w-3.5" />
        )}
      </span>
    </button>
  );
}

function pickActionIcon(status: SessionCheckStatus) {
  switch (status) {
    case "unauth":
      return KeyRound;
    case "error":
      return TriangleAlert;
    case "idle":
      return ShieldQuestion;
    case "verified":
      return RefreshCw;
    case "checking":
    default:
      return CheckCircle2;
  }
}
