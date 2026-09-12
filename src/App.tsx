import { useEffect, useRef, useState } from "react";
import type { Command } from "./lib/types";
import { useT } from "./lib/i18n-context";
import { useJob } from "./hooks/useJob";
import { useQueue } from "./hooks/useQueue";
import { QueueWorkspace } from "./components/QueueWorkspace";
import { readQueueResume, saveQueueResume } from "./lib/queue-resume";
import { useFormState } from "./hooks/useFormState";
import { useDefaultsBootstrap } from "./hooks/useDefaultsBootstrap";
import { useSessionCheck } from "./hooks/useSessionCheck";
import { useSettings } from "./hooks/useSettings";
import { classifyJobError } from "./lib/errors";
import { shouldStartAutomaticSessionCheck } from "./lib/session-verification";
import { TopBar } from "./components/TopBar";
import { Card } from "./components/Card";
import { JobPanel } from "./components/JobPanel";
import { PublishForm, focusFormField } from "./components/PublishForm";
import { ToolsCard } from "./components/ToolsCard";
import { SettingsModal } from "./components/SettingsModal";
import { SessionVerificationDialog } from "./components/SessionVerificationDialog";
import { Toast } from "./components/Toast";

const SESSION_COMMANDS: ReadonlySet<Command> = new Set(["check-session", "login"]);
const NOTION_COMMANDS: ReadonlySet<Command> = new Set([
  "notion-dry-run",
  "notion-publish",
]);

export default function App() {
  const t = useT();
  const job = useJob();
  const queue = useQueue();
  const [view, setView] = useState<"individual" | "queue">("individual");
  const queueRecoveredRef = useRef(false);
  const [restoredResume] = useState(readQueueResume);
  const resumeQueueRef = useRef<string | null>(restoredResume?.batchId || null);
  const resumeRequestedAtRef = useRef(restoredResume?.requestedAt || 0);
  const resumeAfterLoginRef = useRef(!!restoredResume);
  const { settings, update: updateSettings, reset: resetSettings } = useSettings();
  const form = useFormState(settings.formDefaults);
  const bootstrap = useDefaultsBootstrap();
  const session = useSessionCheck();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const autoCheckFiredRef = useRef(false);
  const invalidatedJobRef = useRef<string | null>(null);
  const pendingCommandRef = useRef<Command | null>(null);

  const config = bootstrap.defaults?.config ?? null;
  const isMissingNotionKey = config ? !config.hasNotionApiKey : false;
  const isMissingBlackboardBase = config ? !config.hasBlackboardBaseUrl : false;
  const setupIncomplete = isMissingNotionKey || isMissingBlackboardBase;

  // Each launch performs a silent remote validation. A persisted verification
  // only prevents visual flicker; it never replaces this fresh server check.
  useEffect(() => {
    if (!shouldStartAutomaticSessionCheck({
      alreadyFired: autoCheckFiredRef.current,
      bootstrapReady: bootstrap.status === "ready",
      jobBootstrapped: job.bootstrapped && queue.bootstrapped,
      sessionBootstrapped: session.bootstrapped,
      jobRunning: job.status === "running" || queue.running,
      sessionBusy: session.busy,
      hasBlackboardBaseUrl: !isMissingBlackboardBase,
    })) {
      return;
    }
    autoCheckFiredRef.current = true;
    void session.run("remote", false, true);
  }, [
    bootstrap.status,
    job.bootstrapped,
    queue.bootstrapped,
    queue.running,
    job.status,
    session,
    session.bootstrapped,
    session.busy,
    isMissingBlackboardBase,
  ]);

  useEffect(() => {
    if (!queue.bootstrapped || queueRecoveredRef.current) return;
    queueRecoveredRef.current = true;
    if (queue.snapshot?.batches.length) setView("queue");
  }, [queue.bootstrapped, queue.snapshot]);

  useEffect(() => {
    if (!resumeAfterLoginRef.current || session.busy || !session.bootstrapped || !queue.bootstrapped || !queue.connected) return;
    resumeAfterLoginRef.current = false;
    const batchId = resumeQueueRef.current;
    resumeQueueRef.current = null;
    saveQueueResume(null);
    if (batchId && session.status === "verified" && (session.checkedAt?.getTime() || 0) >= resumeRequestedAtRef.current) void queue.mutate({ action: "resume", batchId });
  }, [session.busy, session.status, session.bootstrapped, queue.bootstrapped, queue.connected, session.checkedAt]);

  useEffect(() => {
    const lastFailure = queue.activeBatch?.items.filter((i) => i.status === "blocked").map((i) => Date.parse(i.attempts.at(-1)?.finishedAt || "")).filter(Number.isFinite);
    if (queue.activeBatch?.reason === "session-required" && (session.checkedAt?.getTime() || 0) < Math.max(0, ...(lastFailure || []))) session.markUnauthenticated();
  }, [queue.activeBatch?.reason, queue.activeBatch?.items, session.markUnauthenticated, session.checkedAt]);

  // Settings is the single source of truth for form defaults. Whenever the
  // user edits a default in the Settings modal, propagate it into the live
  // form immediately so the next Publish/Dry-run picks it up. Without this
  // hook, `useFormState` only consumes `settings.formDefaults` at mount and
  // every later settings change is silently dropped — the form keeps the
  // stale value and `envOverrides` publishes under the wrong Notion parent.
  useEffect(() => {
    form.merge(settings.formDefaults);
    // form.merge is a stable useCallback ref; only the settings snapshot
    // drives this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.formDefaults]);

  useEffect(() => {
    if (
      job.status !== "failed" ||
      !job.job?.id ||
      !job.command ||
      SESSION_COMMANDS.has(job.command) ||
      invalidatedJobRef.current === job.job.id
    ) {
      return;
    }

    const classified = classifyJobError(job.error, job.command, job.logs);
    if (!classified.isAuthIssue) return;
    invalidatedJobRef.current = job.job.id;
    session.markUnauthenticated(classified);
  }, [job.status, job.job?.id, job.command, job.error, job.logs, session.markUnauthenticated]);

  function runCommand(command: Command) {
    if (command !== "check-session") {
      const result = form.validate();
      if (!result.ok && result.firstErrorKey) {
        focusFormField(result.firstErrorKey);
        return;
      }
    }
    const envOverrides: Record<string, string> = {
      COURSE_OUTLINE_URL: form.values.courseOutlineUrl,
      SCORM_TITLE: form.values.scormTitle,
      SCORM_MARKDOWN_OUT: form.values.markdownOutput,
      NOTION_PARENT_PAGE_ID: form.values.notionParentPageId,
      NOTION_PARENT_PAGE_TITLE: form.values.notionParentPageTitle,
      NOTION_PAGE_TITLE: form.values.notionPageTitle,
    };
    if (NOTION_COMMANDS.has(command)) {
      envOverrides.NOTION_MEDIA_WIDTH_RATIO = String(settings.notion.mediaWidthRatio);
      envOverrides.NOTION_PAID_PLAN = settings.notion.paidPlan ? "1" : "0";
    }
    job.start({
      command,
      envOverrides,
      flags: {
        refresh: form.values.refresh,
        deleteAfter: command === "notion-publish" ? form.values.deleteAfter : false,
      },
    });
  }

  function startCommand(command: Command) {
    if (queue.running || !queue.bootstrapped || queue.snapshot?.storageError) return;
    if (!SESSION_COMMANDS.has(command) && session.status !== "verified") {
      pendingCommandRef.current = command;
      if (!session.busy) {
        void session.run("remote", false, true);
      }
      return;
    }
    runCommand(command);
  }

  const isJobRunning = job.status === "running";
  const isAnythingBusy = isJobRunning || session.busy || queue.running || !queue.bootstrapped || !!queue.snapshot?.storageError;
  const showJobPanel =
    job.command !== null &&
    !SESSION_COMMANDS.has(job.command) &&
    job.status !== "idle";

  const sessionErrorToastVisible = !session.busy && !!session.classifiedError;

  useEffect(() => {
    const command = pendingCommandRef.current;
    if (!command || session.busy) return;
    if (session.status === "verified") {
      pendingCommandRef.current = null;
      runCommand(command);
      return;
    }
    if (session.status === "unauth") {
      pendingCommandRef.current = null;
      setSessionDialogOpen(true);
      return;
    }
    if (session.status === "stale" || session.status === "error") {
      pendingCommandRef.current = null;
    }
  }, [session.busy, session.status]);

  function requestRemoteSessionCheck() {
    setSessionDialogOpen(true);
  }

  function confirmRemoteSessionCheck() {
    setSessionDialogOpen(false);
    resumeAfterLoginRef.current = !!resumeQueueRef.current;
    if (resumeQueueRef.current) {
      resumeRequestedAtRef.current = Date.now();
      saveQueueResume({ batchId: resumeQueueRef.current, requestedAt: resumeRequestedAtRef.current });
    }
    void session.run("remote", true);
  }

  return (
    <main className="min-h-screen px-4 pb-12 pt-3 text-ink sm:px-6 lg:px-8">
      <TopBar
        sessionStatus={session.status}
        sessionCheckedAt={session.checkedAt}
        sessionRefreshing={session.refreshing}
        onCheckSession={requestRemoteSessionCheck}
        onSignIn={requestRemoteSessionCheck}
        onOpenSettings={() => setSettingsOpen(true)}
        sessionDisabled={isJobRunning || session.busy || queue.running}
      />

      <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
        <nav aria-label={t("app.title")} className="flex w-fit max-w-full gap-1 rounded-xl border border-line-soft bg-surface p-1 shadow-elev-1">
          {(["individual", "queue"] as const).map((tab) => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => setView(tab)} className={`min-h-11 rounded-lg px-4 text-footnote font-semibold transition-colors ${view === tab ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-quiet"}`}>{t(tab === "individual" ? "queue.individual" : "queue.tab")}</button>)}
        </nav>
        {bootstrap.status === "error" ? (
          <Card tone="warning" enter={false}>
            <p className="text-footnote text-ink">{t("error.boot")}</p>
          </Card>
        ) : null}

        {setupIncomplete ? (
          <Card tone="warning" enter={false} role="alert">
            <h2 className="text-subhead font-semibold text-ink">
              {t("setup.incomplete.title")}
            </h2>
            <p className="mt-1.5 text-footnote leading-snug text-ink-soft">
              {t("setup.incomplete.body")}
            </p>
            <ul className="mt-3 space-y-1.5 text-footnote text-ink-soft">
              {isMissingNotionKey ? (
                <li>
                  <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-caption1">
                    NOTION_API_KEY
                  </code>{" "}
                  — {t("setup.incomplete.notion")}
                </li>
              ) : null}
              {isMissingBlackboardBase ? (
                <li>
                  <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-caption1">
                    BLACKBOARD_BASE_URL
                  </code>{" "}
                  — {t("setup.incomplete.blackboard")}
                </li>
              ) : null}
            </ul>
          </Card>
        ) : null}

        {view === "queue" ? <QueueWorkspace queue={queue} settings={settings} sessionBusy={session.busy} onSignIn={(batchId) => { resumeQueueRef.current = batchId; setSessionDialogOpen(true); }} /> : <PublishForm
          form={form}
          disabled={isAnythingBusy}
          loadingCommand={isJobRunning ? job.command : null}
          onSubmit={startCommand}
        />}

        {view === "individual" && showJobPanel && job.command ? (
          <JobPanel
            command={job.command}
            status={job.status}
            job={job.job}
            phase={job.phase}
            logs={job.logs}
            summary={job.summary}
            finalUrl={job.finalUrl}
            error={job.error}
            onCancel={() => job.cancel()}
            onRetry={() => startCommand(job.command!)}
            onPublish={
              job.command === "notion-dry-run" ? () => startCommand("notion-publish") : undefined
            }
            onDismiss={() => job.reset()}
          />
        ) : null}

        {view === "individual" ? <ToolsCard
          disabled={isAnythingBusy}
          loadingCommand={isJobRunning ? job.command : null}
          onExportMd={() => startCommand("export-md")}
          onVerifySession={requestRemoteSessionCheck}
          sessionBusy={session.busy}
        /> : null}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={updateSettings}
        reset={resetSettings}
        config={config}
      />

      <SessionVerificationDialog
        open={sessionDialogOpen}
        onClose={() => { setSessionDialogOpen(false); resumeQueueRef.current = null; }}
        onConfirm={confirmRemoteSessionCheck}
      />

      {session.busy && session.interactive ? (
        <Toast
          tone="loading"
          title={t("login.waiting.title")}
          description={t("login.waiting.body")}
          action={{ label: t("login.cancel"), onClick: () => session.cancel() }}
          autoDismissMs={0}
        />
      ) : sessionErrorToastVisible && session.classifiedError ? (
        <Toast
          tone="warning"
          title={t(session.classifiedError.titleKey)}
          description={t(session.classifiedError.hintKey)}
          technicalDetails={session.classifiedError.technicalDetails ?? undefined}
          onClose={() => session.dismissError()}
          autoDismissMs={0}
        />
      ) : null}
    </main>
  );
}
