import type { PhaseProgress } from "../lib/types";
import { useT } from "../lib/i18n-context";
import type { StringKey } from "../lib/i18n";

interface Props {
  progress: PhaseProgress | null;
  message?: string;
  running: boolean;
}

const KIND_TO_STRING: Record<string, StringKey> = {
  assets: "progress.assets",
  "upload-parts": "progress.upload-parts",
  "block-batches": "progress.block-batches",
};

export function ProgressBar({ progress, message, running }: Props) {
  const t = useT();
  const ratio =
    progress && progress.total > 0
      ? Math.min(1, Math.max(0, progress.current / progress.total))
      : null;
  const percent = ratio !== null ? Math.round(ratio * 100) : null;

  const kindKey = progress?.kind ? KIND_TO_STRING[progress.kind] : undefined;
  const kindLabel = kindKey ? t(kindKey) : t("progress.generic");

  return (
    <div role="status" aria-live="polite" className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-caption1">
        <span className="font-medium text-ink">
          {progress ? kindLabel : message ?? (running ? t("job.running") : t("job.idle"))}
        </span>
        <span className="text-ink-muted">
          {progress
            ? `${t("progress.count", { current: progress.current, total: progress.total })}${
                percent !== null ? ` · ${t("progress.percent", { n: percent })}` : ""
              }`
            : running
              ? "…"
              : null}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-line)_55%,transparent)]">
        {ratio !== null ? (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-slow ease-emphasized"
            style={{ width: `${ratio * 100}%` }}
          />
        ) : running ? (
          <div className="animate-pulse-subtle absolute inset-y-0 left-0 w-1/3 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_70%,transparent)]" />
        ) : null}
      </div>
      {message && progress ? (
        <p className="text-caption2 text-ink-muted">{message}</p>
      ) : null}
    </div>
  );
}
