import { Settings as SettingsIcon } from "lucide-react";
import { useT } from "../lib/i18n-context";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SessionChip, type SessionCheckStatus } from "./SessionChip";

interface Props {
  sessionStatus: SessionCheckStatus;
  sessionCheckedAt: Date | null;
  onCheckSession: () => void;
  onSignIn: () => void;
  onOpenSettings: () => void;
  sessionDisabled?: boolean;
}

export function TopBar({
  sessionStatus,
  sessionCheckedAt,
  onCheckSession,
  onSignIn,
  onOpenSettings,
  sessionDisabled,
}: Props) {
  const t = useT();
  return (
    <header className="sticky top-0 z-[var(--z-sticky)] -mx-4 mb-6 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="surface mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 rounded-full px-3 py-1.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src="/favicon.svg"
            alt=""
            aria-hidden="true"
            className="h-7 w-7 shrink-0"
          />
          <div className="min-w-0">
            <p className="truncate text-footnote font-semibold text-ink">
              {t("app.title")}
            </p>
            <p className="truncate text-caption1 text-ink-muted">
              {t("app.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SessionChip
            status={sessionStatus}
            checkedAt={sessionCheckedAt}
            onCheck={onCheckSession}
            onSignIn={onSignIn}
            disabled={sessionDisabled}
          />
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t("settings.open")}
            title={t("settings.open")}
            className="surface inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-fast ease-standard hover:text-ink"
          >
            <SettingsIcon className="h-4 w-4" aria-hidden="true" />
          </button>
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
