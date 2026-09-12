import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ExternalLink, ListOrdered, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type { useQueue } from "../hooks/useQueue";
import { useT } from "../lib/i18n-context";
import type { StringKey } from "../lib/i18n";
import type { Settings } from "../lib/settings";
import type { Job, LogEntry, PhaseEvent, QueueConfig, QueueItem, QueueMutation } from "../lib/types";
import { api, subscribeToJob } from "../lib/api";
import { Card } from "./Card";
import { Field } from "./Field";
import { Button } from "./Button";
import { Disclosure } from "./Disclosure";
import { Switch } from "./Switch";
import { Slider } from "./Slider";
import { ActionDialog } from "./ActionDialog";
import { PhaseTimeline } from "./PhaseTimeline";
import { LogStream } from "./LogStream";

function initialConfig(settings: Settings): QueueConfig {
  return { url: "", title: "", parentTitle: settings.formDefaults.notionParentPageTitle,
    parentId: settings.formDefaults.notionParentPageId, scormTitle: "", refresh: settings.formDefaults.refresh,
    paidPlan: settings.notion.paidPlan, mediaWidthRatio: settings.notion.mediaWidthRatio };
}
function displayUrl(value: string) { try { const u = new URL(value); return `${u.hostname}${u.pathname}`; } catch { return ""; } }
function duration(start: string, end: string | null) {
  if (!end) return "—";
  const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function ActivePublication({ item }: { item: QueueItem }) {
  const t = useT();
  const jobId = item.attempts.at(-1)?.jobId;
  const [job, setJob] = useState<Job | null>(item.job);
  const [phase, setPhase] = useState<PhaseEvent | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    void api.getJob(jobId).then((next) => { if (!disposed) setJob(next); }).catch(() => {});
    const close = subscribeToJob(jobId, {
      onPhase: setPhase,
      onLog: (entry) => setLogs((previous) => previous.some((l) => l.id === entry.id) ? previous : [...previous.slice(-199), entry]),
      onDone: setJob,
    });
    return () => { disposed = true; close(); };
  }, [jobId]);
  return <div className="rounded-xl border border-line-soft bg-surface-quiet p-4">
    <div className="mb-3 flex items-center gap-2 text-footnote font-semibold"><Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />{t("queue.active")}</div>
    <PhaseTimeline phase={phase?.phase || job?.currentPhase || "starting"} status="running" command="notion-publish" />
    {phase?.progress ? <p className="mt-3 text-caption1 text-ink-muted">{phase.progress.current} / {phase.progress.total}</p> : null}
    <details className="mt-3"><summary className="w-fit rounded text-caption1 text-ink-muted">{t("job.viewLogs")}</summary><div className="mt-3"><LogStream logs={logs} /></div></details>
  </div>;
}

export function QueueWorkspace({ queue, settings, onSignIn, sessionBusy }: {
  queue: ReturnType<typeof useQueue>; settings: Settings; onSignIn: (batchId: string) => void; sessionBusy: boolean;
}) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const latest = queue.snapshot?.batches.at(-1);
  const batch = queue.snapshot?.batches.find((b) => b.id === selected) || queue.activeBatch || latest;
  const [config, setConfig] = useState(() => initialConfig(settings));
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<QueueMutation | null>(null);
  const [localError, setLocalError] = useState(false);
  const editor = useRef<HTMLFormElement>(null);
  const active = batch?.items.find((i) => i.status === "running");
  const terminal = !!batch && ["completed", "stopped"].includes(batch.status);
  const done = terminal && !active;
  const completedCount = batch?.items.filter((i) => !["pending", "running", "blocked"].includes(i.status)).length || 0;
  const busy = queue.busy || !queue.connected || !!queue.snapshot?.storageError;
  const currentBatch = batch?.id === (queue.activeBatch || latest)?.id;
  const mutate = (value: QueueMutation) => queue.mutate({ batchId: batch?.id, ...value });

  useEffect(() => {
    // Only fresh drafts inherit settings. Existing entries always keep their snapshot.
    if (!editing && !config.url && !config.title) setConfig(initialConfig(settings));
  }, [settings]);
  useEffect(() => { setEditing(null); setConfig(initialConfig(settings)); setLocalError(false); }, [batch?.id]);

  async function addOrSave() {
    setLocalError(false);
    try { const url = new URL(config.url); if (!["https:", "http:"].includes(url.protocol)) throw new Error(); } catch { setLocalError(true); return; }
    if (!batch) {
      // Creating a draft is separate from publishing and never starts a worker.
      await queue.mutate({ action: "create" });
      return;
    }
    if (await mutate({ action: editing ? "edit" : "add", itemId: editing || undefined, config })) {
      setEditing(null); setConfig(initialConfig(settings));
    }
  }
  function edit(item: QueueItem) {
    setEditing(item.id); setConfig({ ...item.config });
    editor.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    editor.current?.querySelector("input")?.focus({ preventScroll: true });
  }
  function move(item: QueueItem, direction: number) {
    const order = batch!.items.filter((i) => i.status === "pending").map((i) => i.id);
    const from = order.indexOf(item.id); const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void mutate({ action: "reorder", order });
  }
  function retry(item: QueueItem) {
    const previous = item.attempts.at(-1);
    const action: QueueMutation = { action: "retry", batchId: batch!.id, itemId: item.id };
    if (item.status === "interrupted" || previous?.notionPageUrl || previous?.publicationStage === "creating-page") setConfirm({ ...action, confirmNewPage: true });
    else void mutate(action);
  }
  const issueKey: StringKey = queue.snapshot?.storageError === "queue-owner" ? "queue.owner" : queue.snapshot?.storageError ? "queue.storage" : queue.error === "queue-full" ? "queue.full" :
    ["revision-conflict", "item-started", "batch-finished", "batch-active"].includes(queue.error || "") ? "queue.conflict" :
    ["invalid-item", "invalid-parent", "invalid-url", "missing-scorm-title"].includes(queue.error || "") ? "queue.invalid" : "queue.problem";
  const reasonKeys: Record<string, StringKey> = {
    manual: "queue.reason.manual", "session-required": "queue.reason.session-required", "profile-busy": "queue.reason.profile-busy",
    "server-restart": "queue.reason.server-restart", "worker-alive": "queue.reason.worker-alive", configuration: "queue.reason.configuration",
  };

  return <section aria-labelledby="queue-title" className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4 py-2">
      <div><h1 id="queue-title" className="text-title1 font-semibold tracking-tight">{done ? t("queue.summary") : t("queue.title")}</h1>
        <p className="mt-2 max-w-prose text-subhead text-ink-muted">{done ? t("queue.finished") : t("queue.subtitle")}</p></div>
      {done && !queue.activeBatch ? <Button label={t("queue.new")} icon={<Plus className="h-4 w-4" />} disabled={busy} onClick={() => { setSelected(null); void queue.mutate({ action: "create" }); }} /> : null}
    </header>
    {!queue.connected ? <Card tone="info" padding="sm" role="status">{t("queue.reconnecting")}</Card> : null}
    {(queue.error && queue.error !== "connection") || queue.snapshot?.storageError ? <Card tone="warning" padding="sm" role="alert">{t(issueKey)}</Card> : null}
    {!batch ? <Card padding="lg"><ListOrdered className="h-8 w-8 text-accent" aria-hidden="true" /><h2 className="mt-4 text-title3 font-semibold">{t("queue.empty")}</h2><p className="mt-2 text-subhead text-ink-muted">{t("queue.emptyBody")}</p><Button className="mt-6" label={t("queue.new")} onClick={() => void queue.mutate({ action: "create" })} disabled={busy} /></Card> : <>
      {batch.status === "paused" && batch.reason ? <Card tone="warning" padding="sm"><p className="text-footnote">{t(reasonKeys[batch.reason] || "queue.problem")}</p>
        {batch.reason === "session-required" ? <Button className="mt-3" label={t("queue.signIn")} disabled={busy || !!active || sessionBusy} onClick={() => onSignIn(batch.id)} /> : null}</Card> : null}
      <div className={terminal ? "space-y-5" : "grid items-start gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]"}>
        {!terminal ? <Card padding="md" className="min-w-0">
          <form ref={editor} noValidate onSubmit={(event) => { event.preventDefault(); void addOrSave(); }} className="space-y-5">
            <div><h2 className="text-title3 font-semibold">{editing ? t("queue.edit") : t("queue.editor")}</h2><p className="mt-1 text-caption1 text-ink-muted">{t("queue.snapshot")}</p></div>
            <Field label={t("field.courseUrl.label")} value={config.url} onChange={(url) => setConfig({ ...config, url })} required spellCheck={false} disabled={busy} error={localError ? t("queue.invalid") : undefined} placeholder="https://…/scorm/overview/…" />
            <Field label={t("field.pageTitle.label")} value={config.title} onChange={(title) => setConfig({ ...config, title })} placeholder={t("queue.auto")} disabled={busy} />
            <div className="border-t border-line-soft pt-5"><Field label={t("field.parentTitle.label")} value={config.parentTitle} onChange={(parentTitle) => setConfig({ ...config, parentTitle })} disabled={busy} /></div>
            <Disclosure title={t("advanced.title")}><div className="space-y-4">
              <Field label={t("field.parentId.label")} value={config.parentId} onChange={(parentId) => setConfig({ ...config, parentId })} disabled={busy} />
              <Field label={t("field.unit.label")} hint={t("field.unit.help")} value={config.scormTitle} onChange={(scormTitle) => setConfig({ ...config, scormTitle })} disabled={busy} />
              <Switch label={t("field.refresh.label")} checked={config.refresh} onChange={(refresh) => setConfig({ ...config, refresh })} disabled={busy} />
              <Switch label={t("settings.notion.paidPlan.label")} checked={config.paidPlan} onChange={(paidPlan) => setConfig({ ...config, paidPlan })} disabled={busy} />
              <Slider label={t("settings.notion.mediaWidthRatio.label")} min={0.5} max={1} step={0.05} value={config.mediaWidthRatio} onChange={(mediaWidthRatio) => setConfig({ ...config, mediaWidthRatio })} disabled={busy} />
            </div></Disclosure>
            {batch.items.length >= 10 && !editing ? <p className="text-footnote text-ink-muted">{t("queue.full")}</p> : null}
            <div className="flex flex-wrap gap-2"><Button type="submit" fullWidth={!editing} label={editing ? t("queue.save") : t("queue.add")} icon={<Plus className="h-4 w-4" />} disabled={busy || (!editing && batch.items.length >= 10)} />
              {editing ? <Button variant="ghost" label={t("queue.cancel")} onClick={() => { setEditing(null); setConfig(initialConfig(settings)); }} /> : null}</div>
          </form>
        </Card> : null}

        <Card padding="md" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-title3 font-semibold">{t("queue.list")}</h2><span className="rounded-full bg-surface-quiet px-3 py-1 text-caption1 font-medium text-ink-muted">{t("queue.count", { n: batch.items.length })}</span></div>
          {batch.items.length ? <div className="mt-4"><div className="h-1.5 overflow-hidden rounded-full bg-line-soft" role="progressbar" aria-label={t("queue.list")} aria-valuemin={0} aria-valuemax={batch.items.length} aria-valuenow={completedCount}><div className="h-full rounded-full bg-accent transition-[width] duration-base" style={{ width: `${100 * completedCount / batch.items.length}%` }} /></div><p aria-live="polite" className="mt-2 text-caption1 text-ink-muted">{t("queue.progress", { done: completedCount, total: batch.items.length })}</p></div> : <p className="py-10 text-center text-subhead text-ink-muted">{t("queue.emptyBody")}</p>}
          {done ? <div className="mt-5 grid grid-cols-3 gap-2">{[
            [t("queue.published"), batch.items.filter((i) => i.status === "success").length],
            [t("queue.issues"), batch.items.filter((i) => ["failed", "incomplete", "interrupted"].includes(i.status)).length],
            [t("queue.total"), batch.items.length],
          ].map(([label, count]) => <div key={label} className="rounded-lg bg-surface-quiet p-3"><p className="text-title2 font-semibold tabular-nums">{count}</p><p className="mt-1 text-caption1 text-ink-muted">{label}</p></div>)}</div> : null}
          <ol className={done ? "mt-5 grid gap-4 md:grid-cols-2" : "scrollbar-quiet mt-3 max-h-[60vh] divide-y divide-line-soft overflow-y-auto overscroll-contain pr-2"}>
            {batch.items.map((item, index) => {
              const attempt = item.attempts.at(-1);
              const pending = batch.items.filter((i) => i.status === "pending");
              return <li key={item.id} className={done ? "min-w-0 rounded-xl border border-line-soft p-4" : "min-w-0 py-4"}>
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-footnote font-semibold ${item.status === "success" ? "bg-success-soft text-ink" : item.status === "running" ? "bg-accent-soft text-accent" : "bg-surface-quiet text-ink-muted"}`}>{item.status === "success" ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}</span>
                  <div className="min-w-0 flex-1"><p className="break-words text-subhead font-semibold">{item.status === "pending" ? item.config.title || t("queue.auto") : attempt?.title || item.config.title || t("queue.auto")}</p>
                    <p className="mt-1 break-all text-caption1 text-ink-muted">{displayUrl(item.config.url)}</p>
                    <p className="mt-1 break-words text-caption1 text-ink-soft">{t("queue.preview")}: {item.config.parentId ? `${item.config.parentTitle} · ${item.config.parentId}` : item.config.parentTitle}</p>
                    <span className={`mt-2 inline-flex rounded-md px-2 py-1 text-caption1 font-medium ${item.status === "success" ? "bg-success-soft" : ["incomplete", "failed", "interrupted", "blocked"].includes(item.status) ? "bg-warning-soft" : "bg-surface-quiet"}`}>{t(`queue.status.${item.status}`)}</span>
                  </div>
                </div>
                {item.status === "pending" && !done ? <div className="mt-3 flex flex-wrap justify-end gap-1">
                  <button type="button" aria-label={`${t("queue.up")} ${index + 1}`} title={t("queue.up")} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-muted hover:bg-surface-quiet disabled:opacity-40" disabled={busy || pending[0]?.id === item.id} onClick={() => move(item, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" aria-label={`${t("queue.down")} ${index + 1}`} title={t("queue.down")} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-muted hover:bg-surface-quiet disabled:opacity-40" disabled={busy || pending.at(-1)?.id === item.id} onClick={() => move(item, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                  <Button variant="ghost" size="sm" label={t("queue.edit")} icon={<Pencil className="h-4 w-4" />} disabled={busy} onClick={() => edit(item)} />
                  <Button variant="ghost" size="sm" label={t("queue.remove")} icon={<Trash2 className="h-4 w-4" />} disabled={busy} onClick={() => void mutate({ action: "remove", itemId: item.id })} />
                </div> : null}
                {item.status === "running" ? <div className="mt-4"><ActivePublication key={attempt?.jobId} item={item} /></div> : null}
                {attempt && item.status !== "running" ? <div className="mt-3 space-y-2 pl-11">
                  <p className="text-caption1 text-ink-muted">{t("queue.duration")}: {duration(attempt.startedAt, attempt.finishedAt)}{attempt.summary?.lessons !== undefined ? ` · ${attempt.summary.lessons} ${t("stats.lessons")} · ${attempt.summary.images || 0} ${t("stats.images")} · ${attempt.summary.videos || 0} ${t("stats.videos")}` : ""}</p>
                  <div className="flex flex-wrap items-center gap-3">{attempt.notionPageUrl ? <a className="inline-flex min-h-11 items-center gap-2 rounded text-footnote font-semibold text-accent" href={attempt.notionPageUrl} target="_blank" rel="noopener noreferrer">{t("queue.open")}<ExternalLink className="h-4 w-4" aria-hidden="true" /></a> : null}
                    {["failed", "cancelled", "incomplete", "interrupted"].includes(item.status) ? <Button variant="secondary" size="sm" label={t("queue.retry")} disabled={busy || !currentBatch} onClick={() => retry(item)} /> : null}</div>
                  {attempt.error ? <details><summary className="w-fit rounded text-caption1 text-ink-muted">{t("queue.details")}</summary><p className="mt-2 whitespace-pre-wrap break-words text-caption1 text-ink-soft">{attempt.error}</p></details> : null}
                  {item.attempts.length > 1 ? <details><summary className="w-fit rounded text-caption1 text-ink-muted">{t("queue.attempts")} ({item.attempts.length - 1})</summary><ul className="mt-2 space-y-2">{item.attempts.slice(0, -1).map((a) => <li key={a.id} className="text-caption1">{t(`queue.status.${a.status}`)} · {new Date(a.startedAt).toLocaleString()} {a.notionPageUrl ? <a className="text-accent underline" href={a.notionPageUrl} target="_blank" rel="noopener noreferrer">{t("queue.open")}</a> : null}</li>)}</ul></details> : null}
                </div> : null}
              </li>;
            })}
          </ol>
          {!terminal ? <footer className="mt-3 space-y-3 border-t border-line-soft pt-5">
            <div className="flex flex-wrap gap-2">{batch.status === "running" ? <Button variant="secondary" label={t("queue.pause")} disabled={busy} onClick={() => void mutate({ action: "pause" })} /> : <Button label={t(batch.status === "draft" ? "queue.start" : "queue.resume")} disabled={busy || sessionBusy || !batch.items.some((i) => ["pending", "blocked"].includes(i.status)) || batch.reason === "session-required"} onClick={() => void mutate({ action: batch.status === "draft" ? "start" : "resume" })} />}
              {active ? <Button variant="ghost" label={t("queue.cancelCurrent")} disabled={busy} onClick={() => setConfirm({ action: "cancel-current", batchId: batch.id })} /> : null}
              <Button variant="ghost" label={t("queue.stop")} disabled={busy} onClick={() => setConfirm({ action: "stop", batchId: batch.id })} /></div>
            {batch.status === "running" && !active ? <p role="status" className="text-caption1 text-ink-muted">{t("queue.waiting")}</p> : null}
            <p className="text-caption1 text-ink-muted">{t("queue.saved")}</p>
          </footer> : null}
        </Card>
      </div>
    </>}
    {(queue.snapshot?.batches.length || 0) > 1 ? <details className="rounded-xl border border-line-soft bg-surface p-4"><summary className="w-fit rounded text-footnote font-medium">{t("queue.history")}</summary><div className="mt-3 flex flex-wrap gap-2">{queue.snapshot!.batches.map((b) => <Button key={b.id} variant="secondary" size="sm" label={`${new Date(b.createdAt).toLocaleString()} · ${b.items.length}`} onClick={() => setSelected(b.id)} />)}<Button variant="ghost" size="sm" label={t("queue.back")} onClick={() => setSelected(null)} /></div></details> : null}
    <ActionDialog open={!!confirm} title={t(confirm?.action === "retry" ? "queue.reviewTitle" : confirm?.action === "stop" ? "queue.stop" : "queue.cancelCurrent")} onClose={() => setConfirm(null)} onConfirm={() => { if (confirm) void queue.mutate(confirm); setConfirm(null); }}>
      {t(confirm?.action === "retry" ? "queue.reviewBody" : confirm?.action === "stop" ? "queue.stopBody" : "queue.cancelBody")}
    </ActionDialog>
  </section>;
}
