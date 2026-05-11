import { useEffect, useRef, useState } from "react";
import type { Command } from "./lib/types";
import { useT } from "./lib/i18n-context";
import { useJob } from "./hooks/useJob";
import { useFormState } from "./hooks/useFormState";
import { useDefaultsBootstrap } from "./hooks/useDefaultsBootstrap";
import { useSessionCheck } from "./hooks/useSessionCheck";
import { useLogin } from "./hooks/useLogin";
import { useSettings } from "./hooks/useSettings";
import { TopBar } from "./components/TopBar";
import { Card } from "./components/Card";
import { JobPanel } from "./components/JobPanel";
import { PublishForm, focusFormField } from "./components/PublishForm";
import { ToolsCard } from "./components/ToolsCard";
import { SettingsModal } from "./components/SettingsModal";
import { Toast } from "./components/Toast";

const SESSION_COMMANDS: ReadonlySet<Command> = new Set(["check-session", "login"]);
const NOTION_COMMANDS: ReadonlySet<Command> = new Set([
  "notion-dry-run",
  "notion-publish",
]);

export default function App() {
  const t = useT();
  const job = useJob();
  const { settings, update: updateSettings, reset: resetSettings } = useSettings();
  const form = useFormState(settings.formDefaults);
  const bootstrap = useDefaultsBootstrap();
  const session = useSessionCheck();
  const login = useLogin({ onCompleted: () => session.run() });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const autoCheckFiredRef = useRef(false);

  const config = bootstrap.defaults?.config ?? null;
  const isMissingNotionKey = config ? !config.hasNotionApiKey : false;
  const isMissingBlackboardBase = config ? !config.hasBlackboardBaseUrl : false;
  const setupIncomplete = isMissingNotionKey || isMissingBlackboardBase;

  // Auto-verify the session once after bootstrap + job rehydrate have settled.
  // Skip when the install is missing `BLACKBOARD_BASE_URL` — otherwise we'd
  // immediately fail with a config error before the user has done anything.
  useEffect(() => {
    if (autoCheckFiredRef.current) return;
    if (bootstrap.status !== "ready") return;
    if (!job.bootstrapped) return;
    if (session.status !== "idle") return;
    if (isMissingBlackboardBase) return;
    autoCheckFiredRef.current = true;
    session.run();
  }, [bootstrap.status, job.bootstrapped, session, isMissingBlackboardBase]);

  function startCommand(command: Command) {
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

  const isJobRunning = job.status === "running";
  const isAnythingBusy = isJobRunning || session.busy || login.busy;
  const showJobPanel =
    job.command !== null &&
    !SESSION_COMMANDS.has(job.command) &&
    job.status !== "idle";

  const sessionErrorToastVisible = session.status === "error" && !!session.classifiedError;

  return (
    <main className="min-h-screen px-4 pb-12 pt-3 text-ink sm:px-6 lg:px-8">
      <TopBar
        sessionStatus={session.status}
        sessionCheckedAt={session.checkedAt}
        onCheckSession={() => session.run()}
        onSignIn={() => login.start()}
        onOpenSettings={() => setSettingsOpen(true)}
        sessionDisabled={isJobRunning || login.busy}
      />

      <div className="mx-auto flex max-w-[960px] flex-col gap-5">
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

        <PublishForm
          form={form}
          disabled={isAnythingBusy}
          loadingCommand={isJobRunning ? job.command : null}
          onSubmit={startCommand}
        />

        {showJobPanel && job.command ? (
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

        <ToolsCard
          disabled={isAnythingBusy}
          loadingCommand={isJobRunning ? job.command : null}
          onExportMd={() => startCommand("export-md")}
        />
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        update={updateSettings}
        reset={resetSettings}
        config={config}
      />

      {login.busy ? (
        <Toast
          tone="loading"
          title={t("login.waiting.title")}
          description={t("login.waiting.body")}
          action={{ label: t("login.cancel"), onClick: () => login.cancel() }}
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
