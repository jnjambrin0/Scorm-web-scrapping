import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { Command, JobSummary, LogEntry } from "../lib/types";
import type { UiStatus } from "../hooks/useJob";
import { useT } from "../lib/i18n-context";
import type { StringKey } from "../lib/i18n";
import { classifyJobError, type ClassifiedError } from "../lib/errors";
import { Card, type CardTone } from "./Card";
import { Button } from "./Button";

interface Props {
  command: Command;
  status: UiStatus;
  summary: JobSummary | null;
  finalUrl: string | null;
  error: string | null;
  logs: LogEntry[];
  onRetry: () => void;
  onPublish?: () => void;
  onDismiss?: () => void;
}

function formatNumber(value?: number) {
  return typeof value === "number" ? new Intl.NumberFormat().format(value) : "—";
}

function formatBytes(value?: number) {
  if (!value || value <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB"];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md border border-line bg-surface px-3 py-2">
      <span className="text-caption2 font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="mt-0.5 text-subhead font-semibold text-ink">{value}</span>
    </div>
  );
}

function getSuccessKeys(command: Command): {
  titleKey: StringKey;
  subtitleKey: StringKey;
} | null {
  switch (command) {
    case "notion-publish":
      return {
        titleKey: "result.success.publish.title",
        subtitleKey: "result.success.publish.subtitle",
      };
    case "notion-dry-run":
      return {
        titleKey: "result.success.dryrun.title",
        subtitleKey: "result.success.dryrun.subtitle",
      };
    case "export-md":
      return {
        titleKey: "result.success.exportMd.title",
        subtitleKey: "result.success.exportMd.subtitle",
      };
    case "check-session":
    case "login":
      return null;
  }
}

export function ResultCard({
  command,
  status,
  summary,
  finalUrl,
  error,
  logs,
  onRetry,
  onPublish,
  onDismiss,
}: Props) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);

  // ResultCard never renders for check-session or login — those are handled
  // by the SessionChip + Toast surface instead.
  if (command === "check-session" || command === "login") {
    return null;
  }

  const isSuccess = status === "success";
  const isFailure = status === "failed";
  const isCancelled = status === "cancelled";

  const classified: ClassifiedError | null = isFailure
    ? classifyJobError(error, command, logs)
    : null;

  const tone: CardTone = isSuccess ? "success" : isFailure ? "danger" : "warning";
  const Icon = isSuccess ? CheckCircle2 : isFailure ? XCircle : AlertTriangle;
  const iconColor = isSuccess
    ? "text-success"
    : isFailure
      ? "text-danger"
      : "text-warning";

  let title: string;
  let subtitle: string;
  if (isSuccess) {
    const keys = getSuccessKeys(command);
    if (!keys) return null;
    title = t(keys.titleKey);
    subtitle = t(keys.subtitleKey);
  } else if (isFailure && classified) {
    title = t(classified.titleKey);
    subtitle = t(classified.hintKey);
  } else {
    title = t("result.cancelled.title");
    subtitle = t("result.cancelled.subtitle");
  }

  const showStats =
    isSuccess &&
    summary &&
    (command === "notion-publish" ||
      command === "notion-dry-run" ||
      command === "export-md");

  return (
    <Card tone={tone} padding="md">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface"
        >
          <Icon className={["h-5 w-5", iconColor].join(" ")} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-title3 font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-footnote leading-snug text-ink-soft">{subtitle}</p>
        </div>
      </div>

      {showStats && summary ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatPill label={t("stats.lessons")} value={formatNumber(summary.lessons)} />
          <StatPill label={t("stats.blocks")} value={formatNumber(summary.blocks)} />
          <StatPill label={t("stats.images")} value={formatNumber(summary.images)} />
          <StatPill label={t("stats.videos")} value={formatNumber(summary.videos)} />
          <StatPill label={t("stats.uploaded")} value={formatNumber(summary.uploadedAssets)} />
          <StatPill label={t("stats.bytes")} value={formatBytes(summary.totalAssetBytes)} />
        </div>
      ) : null}

      {summary?.deletedAfterValidation ? (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)] bg-warning-soft px-2.5 py-1 text-caption1 text-warning">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {t("stats.deleted")}
        </p>
      ) : null}

      {classified?.technicalDetails ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="text-caption1 font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            {detailsOpen ? t("result.hideDetails") : t("result.showDetails")}
          </button>
          {detailsOpen ? (
            <pre className="scrollbar-quiet mt-2 max-h-48 overflow-auto rounded-md border border-line bg-log-bg p-3 font-mono text-mono text-log-text">
              {classified.technicalDetails}
            </pre>
          ) : null}
        </div>
      ) : null}

      {isSuccess && command === "notion-publish" && finalUrl ? (
        <a
          href={finalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-5 flex w-full items-center justify-between gap-4 rounded-lg bg-success px-5 py-4 text-white shadow-button-success transition-colors duration-fast ease-standard hover:bg-success-hover sm:px-6 sm:py-5"
        >
          <span className="flex min-w-0 items-center gap-3.5">
            <span
              aria-hidden="true"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15"
            >
              <ExternalLink className="h-5 w-5" />
            </span>
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="text-body font-semibold">{t("result.openNotion")}</span>
              {summary?.title ? (
                <span className="mt-0.5 max-w-full truncate text-caption1 font-normal text-white/85">
                  {summary.title}
                </span>
              ) : null}
            </span>
          </span>
          <ArrowRight
            className="h-5 w-5 shrink-0 transition-transform duration-fast ease-standard group-hover:translate-x-1"
            aria-hidden="true"
          />
        </a>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        {isSuccess && command === "notion-dry-run" && onPublish ? (
          <Button
            variant="primary"
            tone="accent"
            size="md"
            label={t("action.publishNow")}
            icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
            onClick={onPublish}
          />
        ) : null}

        {isFailure || isCancelled ? (
          <Button
            variant="secondary"
            size="md"
            label={t("action.retry")}
            icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
            onClick={onRetry}
          />
        ) : null}

        {onDismiss ? (
          <Button
            variant="ghost"
            size="md"
            label={t("action.dismiss")}
            onClick={onDismiss}
          />
        ) : null}
      </div>
    </Card>
  );
}
