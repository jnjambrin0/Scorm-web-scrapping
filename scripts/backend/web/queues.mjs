import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { safeDiagnostic } from "../shared/job-failure.mjs";
import { sanitizeText } from "../shared/text.mjs";
import { parseScormUrl } from "../scorm/urls.mjs";

export class QueueError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const now = () => new Date().toISOString();
const fail = (code, message, status) => { throw new QueueError(code, message, status); };
const copy = (value) => structuredClone(value);

export function queueConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("invalid-item", "Revisa los campos del elemento.");
  const string = (key, fallback = "") => {
    const value = input[key] ?? fallback;
    if (typeof value !== "string" || value.length > 2000) fail("invalid-item", "Revisa los campos del elemento.");
    return value.trim();
  };
  let url;
  try { url = new URL(string("url")); } catch { fail("invalid-url", "Introduce una URL de Blackboard válida."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail("invalid-url", "La URL no puede contener credenciales.");
  url.hash = "";
  const scormTitle = string("scormTitle");
  if (!parseScormUrl(url.href) && !scormTitle) fail("missing-scorm-title", "Para un outline genérico, indica el título visible de la unidad.");
  const parentId = string("parentId");
  if (parentId && !/^(?:[a-f\d]{32}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i.test(parentId)) fail("invalid-parent", "El ID de la página padre no es válido.");
  const mediaWidthRatio = input.mediaWidthRatio ?? 0.85;
  if (!Number.isFinite(mediaWidthRatio) || mediaWidthRatio < 0.5 || mediaWidthRatio > 1) fail("invalid-item", "El ancho de medios no es válido.");
  return { url: url.href, title: string("title"), parentTitle: string("parentTitle", "Universidad") || "Universidad", parentId,
    scormTitle, refresh: input.refresh === true, paidPlan: input.paidPlan === true, mediaWidthRatio };
}

function publicationUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && /(^|\.)notion\.(so|site)$/.test(url.hostname) ? `${url.origin}${url.pathname}` : null; } catch { return null; }
}

function safeSummary(summary) {
  return Object.fromEntries(["lessons", "blocks", "images", "videos", "uploadedAssets", "failedAssets", "failedUploads", "totalAssetBytes"].filter((key) => Number.isFinite(summary[key])).map((key) => [key, summary[key]]));
}

export class QueueManager extends EventEmitter {
  constructor({ store, admission, cancel, getJob, serializeJob, validate = () => null, alive = (pid) => {
    try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
  } }) {
    super();
    Object.assign(this, { store, admission, cancel, getJob, serializeJob, validate, alive });
    this.tail = Promise.resolve();
    this.state = { schemaVersion: 1, revision: 0, batches: [], operations: {} };
    this.storageError = null;
    this.stopped = false;
    this.pumping = false;
  }

  async init() {
    try {
      await this.store.acquire?.();
      this.state = await this.store.load();
      if (this.state.batches.some((b) => b.status === "running" || b.items.some((i) => i.status === "running"))) {
        await this.change((state) => {
          for (const batch of state.batches) {
            if (batch.status === "running" || batch.items.some((item) => item.status === "running")) {
              batch.status = "paused"; batch.reason = "server-restart";
            }
            for (const item of batch.items) {
              if (item.status !== "running") continue;
              const attempt = item.attempts.at(-1);
              item.status = attempt.publicationStage === "completed" ? "success" : "interrupted";
              attempt.status = item.status; attempt.finishedAt = now();
              attempt.errorCode = item.status === "interrupted" ? "server-restart" : null;
            }
            if (batch.status === "paused" && !batch.items.some((i) => ["pending", "blocked"].includes(i.status))) batch.status = "completed";
          }
        });
      }
    } catch (error) { this.storageError = error.code === "queue-owner" ? "queue-owner" : "queue-storage"; }
  }

  snapshot() {
    return { revision: this.state.revision, storageError: this.storageError, batches: this.state.batches.map((batch) => ({
      ...copy(batch), items: batch.items.map((item) => ({ ...copy(item), attempts: item.attempts.map(({ pid, ...attempt }) => copy(attempt)),
        job: item.status === "running" ? this.serializeJob(this.getJob(item.attempts.at(-1)?.jobId)) : null,
      })),
    })) };
  }

  reserved() { return this.state.batches.some((batch) => batch.status === "running"); }

  change(update, { recover = false } = {}) {
    const operation = this.tail.then(async () => {
      if (this.storageError && !recover) fail("queue-storage", "No se puede guardar la cola. Revisa el almacenamiento y vuelve a conectar.", 503);
      const next = copy(this.state);
      const changed = await update(next);
      if (changed === false) return this.snapshot();
      next.revision += 1;
      try { await this.store.save(next); } catch {
        this.storageError = "queue-storage";
        this.emit("snapshot", this.snapshot());
        fail("queue-storage", "No se puede guardar la cola. No se iniciarán nuevos trabajos.", 503);
      }
      this.state = next;
      this.storageError = null;
      this.emit("snapshot", this.snapshot());
      return this.snapshot();
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  async mutate(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("invalid-operation", "La petición no es válida.");
    const { operationId, revision, action, batchId, itemId } = body;
    if (typeof operationId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(operationId)) fail("invalid-operation", "Falta el identificador de operación.");
    const config = ["add", "edit"].includes(action) ? queueConfig(body.config) : undefined;
    // Persist only the public operation contract, never arbitrary request keys.
    const fingerprint = JSON.stringify({ operationId, revision, action,
      batchId: action === "create" ? undefined : batchId,
      itemId: ["edit", "remove", "retry"].includes(action) ? itemId : undefined,
      config, order: action === "reorder" ? body.order : undefined,
      confirmNewPage: action === "retry" ? body.confirmNewPage === true : undefined });
    let cancelId = null;
    const result = await this.change((state) => {
      if (state.operations[operationId]) {
        if (state.operations[operationId] !== fingerprint) fail("operation-conflict", "La operación ya se utilizó con otros datos.", 409);
        return false;
      }
      if (revision !== state.revision) fail("revision-conflict", "La cola cambió en otra ventana. Revisa la lista actualizada.", 409);
      if (action === "create") {
        if (state.batches.some((b) => !["completed", "stopped"].includes(b.status) || b.items.some((i) => i.status === "running"))) fail("batch-active", "Termina o detén el lote actual antes de crear otro.", 409);
        state.batches.push({ id: crypto.randomUUID(), createdAt: now(), status: "draft", reason: null, items: [] });
      } else {
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) fail("batch-missing", "Lote no encontrado.", 404);
        const item = batch.items.find((i) => i.id === itemId);
        if (["edit", "remove", "retry"].includes(action) && !item) fail("item-missing", "Elemento no encontrado.", 404);
        if (["add", "edit", "remove", "reorder"].includes(action) && ["completed", "stopped"].includes(batch.status)) fail("batch-finished", "Este lote ya ha terminado.", 409);
        switch (action) {
          case "add":
            if (batch.items.length >= 10) fail("queue-full", "El lote admite hasta 10 elementos.", 409);
            batch.items.push({ id: crypto.randomUUID(), config, status: "pending", attempts: [] });
            break;
          case "edit":
          case "remove":
            if (item.status !== "pending") fail("item-started", "Solo se pueden modificar elementos pendientes.", 409);
            if (action === "edit") item.config = config;
            else batch.items = batch.items.filter((i) => i.id !== itemId);
            break;
          case "reorder": {
            const pending = batch.items.filter((i) => i.status === "pending");
            if (!Array.isArray(body.order) || body.order.length !== pending.length || new Set(body.order).size !== pending.length || body.order.some((id) => !pending.some((i) => i.id === id))) fail("invalid-order", "El orden de pendientes no es válido.");
            let index = 0;
            const reordered = body.order.map((id) => pending.find((p) => p.id === id));
            batch.items = batch.items.map((i) => i.status === "pending" ? reordered[index++] : i);
            break;
          }
          case "start":
          case "resume":
            if (["completed", "stopped"].includes(batch.status)) fail("batch-finished", "Selecciona un reintento o crea otro lote.", 409);
            if (!batch.items.some((i) => ["pending", "blocked"].includes(i.status))) fail("queue-empty", "Añade al menos un elemento pendiente.");
            for (const i of batch.items) if (i.status === "blocked") i.status = "pending";
            batch.status = "running"; batch.reason = null;
            break;
          case "pause": batch.status = "paused"; batch.reason = "manual"; break;
          case "cancel-current":
          case "stop": {
            cancelId = batch.items.find((i) => i.status === "running")?.attempts.at(-1)?.jobId;
            batch.status = action === "stop" ? "stopped" : "paused"; batch.reason = "manual";
            if (action === "stop") for (const i of batch.items) if (["pending", "blocked"].includes(i.status)) i.status = "cancelled";
            break;
          }
          case "retry": {
            if (!["failed", "cancelled", "incomplete", "interrupted"].includes(item.status)) fail("invalid-retry", "Este elemento no admite reintento.", 409);
            if (state.batches.some((b) => b.id !== batchId && (!["completed", "stopped"].includes(b.status) || b.items.some((i) => i.status === "running")))) fail("batch-active", "Hay otro lote activo.", 409);
            const previous = item.attempts.at(-1);
            if ((previous?.publicationStage === "creating-page" || previous?.notionPageUrl || item.status === "interrupted") && body.confirmNewPage !== true) fail("publication-review", "Revisa Notion antes de reintentar: se creará otra página.", 409);
            item.status = "pending";
            if (batch.status !== "running") { batch.status = "paused"; batch.reason = "manual"; }
            break;
          }
          default: fail("invalid-action", "Acción de cola no válida.");
        }
      }
      state.operations[operationId] = fingerprint;
    });
    if (cancelId) this.cancel(this.getJob(cancelId));
    this.kick();
    return result;
  }

  kick() { void this.pump().catch(() => {}); }

  async pump() {
    if (this.pumping || this.stopped || this.storageError) return;
    this.pumping = true;
    try {
      const batch = this.state.batches.find((b) => b.status === "running");
      if (!batch || batch.items.some((i) => i.status === "running")) return;
      const item = batch.items.find((i) => i.status === "pending");
      if (!item) { await this.change((s) => { s.batches.find((b) => b.id === batch.id).status = "completed"; }); return; }
      if (this.state.batches.some((b) => b.items.some((i) => i.attempts.some((a) => a.pid && this.alive(a.pid))))) {
        await this.pauseReason(batch.id, "worker-alive"); return;
      }
      const issue = this.validate("notion-publish");
      if (issue) { await this.pauseReason(batch.id, "configuration"); return; }
      const id = crypto.randomUUID();
      const c = item.config;
      let job;
      try {
        job = await this.admission.start({ id, command: "notion-publish", queueBatchId: batch.id, queueItemId: item.id,
          flags: { refresh: c.refresh, deleteAfter: false },
          envOverrides: { COURSE_OUTLINE_URL: c.url, NOTION_PAGE_TITLE: c.title, NOTION_PARENT_PAGE_ID: c.parentId,
            NOTION_PARENT_PAGE_TITLE: c.parentTitle, SCORM_TITLE: c.scormTitle, SCORM_MARKDOWN_OUT: "",
            NOTION_MEDIA_WIDTH_RATIO: String(c.mediaWidthRatio), NOTION_PAID_PLAN: c.paidPlan ? "1" : "0" },
          onCheckpoint: (message) => this.checkpoint(batch.id, item.id, id, message),
        }, { queue: true, beforeStart: () => this.change((s) => {
          const current = s.batches.find((b) => b.id === batch.id);
          const entry = current.items.find((i) => i.id === item.id);
          if (current.status !== "running" || entry?.status !== "pending" || JSON.stringify(entry.config) !== JSON.stringify(c) || current.items.find((i) => i.status === "pending")?.id !== item.id) fail("queue-changed", "La cola cambió antes del inicio.", 409);
          entry.status = "running";
          entry.attempts.push({ id: crypto.randomUUID(), jobId: id, status: "running", startedAt: now(), finishedAt: null, publicationStage: "prepared", pid: null });
        }) });
      } catch (error) {
        if (error.code === "application-job") return;
        if (error.code === "queue-changed") { setImmediate(() => this.kick()); return; }
        if (this.state.batches.find((b) => b.id === batch.id)?.items.find((i) => i.id === item.id)?.status === "running" && !this.storageError) {
          await this.finish(batch.id, item.id, { id, status: "failed", error: "Could not start publication worker.", errorCode: "job-failed" });
        }
        await this.pauseReason(batch.id, error.code === "profile-busy" ? "profile-busy" : "configuration");
        return;
      }
      job.completion.then(() => this.finish(batch.id, item.id, job)).catch(() => {});
    } finally { this.pumping = false; }
  }

  pauseReason(id, reason) {
    return this.change((s) => { const b = s.batches.find((b) => b.id === id); b.status = "paused"; b.reason = reason; });
  }

  checkpoint(batchId, itemId, jobId, message) {
    return this.change((s) => {
      const item = s.batches.find((b) => b.id === batchId).items.find((i) => i.id === itemId);
      const attempt = item.attempts.find((a) => a.jobId === jobId);
      if (!attempt || item.status !== "running") fail("invalid-checkpoint", "El intento ya no está activo.");
      if (message.stage === "worker-start") attempt.pid = Number.isInteger(message.pid) ? message.pid : null;
      else if (["creating-page", "page-created", "completed"].includes(message.stage)) {
        attempt.publicationStage = message.stage;
        if (message.pageId) attempt.notionPageId = String(message.pageId).slice(0, 100);
        if (message.pageUrl) attempt.notionPageUrl = publicationUrl(message.pageUrl);
        if (message.title) attempt.title = sanitizeText(String(message.title)).slice(0, 2000);
        if (message.stage === "completed" && message.summary) attempt.summary = safeSummary(message.summary);
      }
    });
  }

  async finish(batchId, itemId, job) {
    await this.change((s) => {
      const batch = s.batches.find((b) => b.id === batchId);
      const item = batch.items.find((i) => i.id === itemId);
      const attempt = item.attempts.find((a) => a.jobId === job.id);
      if (!attempt || attempt.status !== "running") return;
      attempt.pid = null; attempt.finishedAt = job.finishedAt || now();
      attempt.error = safeDiagnostic(sanitizeText(job.error));
      attempt.errorCode = job.errorCode || null;
      const summary = job.summary || {};
      attempt.summary = { ...attempt.summary, ...safeSummary(summary) };
      attempt.title = summary.title ? sanitizeText(summary.title) : attempt.title;
      attempt.notionPageUrl = publicationUrl(job.finalUrl) || attempt.notionPageUrl || null;
      const blocked = ["session-required", "profile-busy"].includes(job.errorCode);
      item.status = job.status === "success" ? "success" : attempt.notionPageUrl ? "incomplete" : job.status;
      attempt.status = item.status;
      if (blocked && batch.status !== "stopped") {
        batch.status = "paused"; batch.reason = job.errorCode;
        if (!attempt.notionPageUrl && !["creating-page", "page-created"].includes(attempt.publicationStage)) item.status = "blocked";
      }
      if (["running", "paused"].includes(batch.status) && !batch.items.some((i) => ["pending", "running", "blocked"].includes(i.status))) batch.status = "completed";
    });
    this.kick();
  }

  stream(request, response) {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
    const send = (snapshot) => response.write(`id: ${snapshot.revision}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    // Full snapshots also recover clients whose event cursor predates a restart.
    send(this.snapshot());
    this.on("snapshot", send);
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
    request.on("close", () => { clearInterval(heartbeat); this.off("snapshot", send); });
  }

  async shutdown() {
    this.stopped = true;
    await this.change((s) => { for (const b of s.batches) if (b.status === "running") { b.status = "paused"; b.reason = "server-restart"; } }).catch(() => {});
    await this.tail;
  }
}
