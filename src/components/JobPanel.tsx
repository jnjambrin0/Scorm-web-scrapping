import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Square } from "lucide-react";
import type { Command, Job, JobSummary, LogEntry, PhaseEvent } from "../lib/types";
import type { UiStatus } from "../hooks/useJob";
import { useT } from "../lib/i18n-context";
import { Card } from "./Card";
import { Button } from "./Button";
import { PhaseTimeline } from "./PhaseTimeline";
import { ProgressBar } from "./ProgressBar";
import { LogStream } from "./LogStream";
import { ResultCard } from "./ResultCard";

interface Props {
  command: Command;
  status: UiStatus;
  job: Job | null;
  phase: PhaseEvent | null;
  logs: LogEntry[];
  summary: JobSummary | null;
  finalUrl: string | null;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onPublish?: () => void;
  onDismiss?: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function JobPanel({
  command,
  status,
  job,
  phase,
  logs,
  summary,
  finalUrl,
  error,
  onCancel,
  onRetry,
  onPublish,
  onDismiss,
}: Props) {
  const t = useT();
  const [logsOpen, setLogsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "running") {
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [status]);

  // Defense-in-depth: check-session and login are handled by the SessionChip + Toast surface
  // and should never reach the JobPanel.
  if (status === "idle" || command === "check-session" || command === "login") {
    return null;
  }

  const startedAt = job?.startedAt ? new Date(job.startedAt).getTime() : null;
  const elapsedMs = startedAt ? now - startedAt : 0;
  const isRunning = status === "running";
  const compact = command === "export-md";
  const runningHeadline = phase?.message ?? t("job.starting");

  return (
    <div className="space-y-4">
      {!isRunning ? (
        <ResultCard
          command={command}
          status={status}
          summary={summary}
          finalUrl={finalUrl}
          error={error}
          logs={logs}
          onRetry={onRetry}
          onPublish={onPublish}
          onDismiss={onDismiss}
        />
      ) : null}

      <Card tone="neutral" elevation={1} padding="md">
        {isRunning ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
              <div>
                <p className="text-footnote font-semibold text-ink">{runningHeadline}</p>
                <p className="text-caption2 text-ink-muted">
                  {startedAt
                    ? t("job.elapsed", { n: formatElapsed(elapsedMs) })
                    : t("job.idle")}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              label={t("action.cancel")}
              icon={<Square className="h-3.5 w-3.5 text-danger" aria-hidden="true" />}
              onClick={onCancel}
            />
          </div>
        ) : null}

        {!compact ? (
          <div className={isRunning ? "mt-4" : ""}>
            <PhaseTimeline
              phase={phase?.phase ?? job?.currentPhase ?? null}
              status={status}
              command={command}
            />
          </div>
        ) : null}

        <div className={!compact || isRunning ? "mt-4" : ""}>
          <ProgressBar
            progress={phase?.progress ?? null}
            message={phase?.message}
            running={isRunning}
          />
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setLogsOpen((prev) => !prev)}
            aria-expanded={logsOpen}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-caption1 font-medium text-ink transition-colors duration-fast ease-standard hover:bg-surface-quiet"
          >
            {logsOpen ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {logsOpen ? t("job.hideLogs") : t("job.viewLogs")}
            <span className="text-ink-muted">· {logs.length}</span>
          </button>
          {logsOpen ? (
            <div className="mt-3">
              <LogStream logs={logs} />
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
