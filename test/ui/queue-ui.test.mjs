import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";
import { QueueManager } from "../../scripts/backend/web/queues.mjs";
import { createAdmission } from "../../scripts/backend/web/admission.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(predicate) { for (let n = 0; n < 100; n++) { if (predicate()) return; await tick(); } assert.fail("Fixture did not settle"); }
async function fixture() {
  const jobs = []; let manager;
  const serialize = (job) => job ? Object.fromEntries(Object.entries(job).filter(([key]) => !["completion", "finish", "onCheckpoint", "envOverrides"].includes(key))) : null;
  const admission = createAdmission({ active: () => jobs.find((j) => j.status === "running"), inspect: async () => ({ state: "available" }),
    reuse: () => false, serialize, reserved: () => manager.reserved(), create: (request) => {
      let resolve;
      const job = { ...request, id: request.id || crypto.randomUUID(), startedAt: new Date().toISOString(), currentPhase: "blackboard-bootstrap", status: "running", summary: null,
        completion: new Promise((done) => { resolve = done; }),
        finish(status, extra = {}) { Object.assign(this, { status, finishedAt: new Date().toISOString() }, extra); resolve(this); manager.kick(); } };
      jobs.push(job); return job;
    } });
  manager = new QueueManager({ store: { load: async () => ({ schemaVersion: 1, revision: 0, batches: [], operations: {} }), save: async () => {} },
    admission, cancel: (j) => j.finish("cancelled"), getJob: (id) => jobs.find((j) => j.id === id), serializeJob: serialize, alive: () => false });
  await manager.init();
  const mutate = (action, extra = {}) => manager.mutate({ action, batchId: manager.snapshot().batches.at(-1)?.id, operationId: crypto.randomUUID(), revision: manager.snapshot().revision, ...extra });
  const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  let authRequests = 0;
  let holdAuth = false;
  const authClients = new Set();
  const sessionJob = { id: "fixture-auth", command: "check-session", status: "success", currentPhase: "done", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), remote: true,
    summary: { session: { mode: "remote", interaction: "none", verified: true, profileEvidence: "present", destination: "blackboard", outcome: "verified" } } };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/queues/events") { manager.stream(req, res); return; }
      if (url.pathname === "/api/queues" && req.method === "GET") { json(res, 200, manager.snapshot()); return; }
      if (url.pathname === "/api/queues" && req.method === "POST") {
        let body = ""; for await (const part of req) body += part; json(res, 200, await manager.mutate(JSON.parse(body))); return;
      }
      if (url.pathname === "/api/config/defaults") { json(res, 200, { notionParentPageTitle: "Universidad", config: { hasNotionApiKey: true, hasBlackboardBaseUrl: true, blackboardBaseUrl: "https://fixture.blackboard.invalid/ultra/stream" } }); return; }
      if (url.pathname === "/api/jobs/active") { json(res, 200, { jobs: [...jobs.filter((j) => j.status === "running").map(serialize), ...(sessionJob.status === "running" ? [sessionJob] : [])], profile: { state: "available" } }); return; }
      if (url.pathname === "/api/jobs" && req.method === "POST") {
        let body = ""; for await (const part of req) body += part;
        sessionJob.interactive = JSON.parse(body).flags?.interactive === true;
        if (sessionJob.interactive && holdAuth) sessionJob.status = "running";
        authRequests++; json(res, 201, sessionJob); return;
      }
      const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(\/events)?$/);
      if (match) {
        const job = match[1] === sessionJob.id ? sessionJob : serialize(jobs.find((j) => j.id === match[1]));
        if (!job) { json(res, 404, { error: "Not found" }); return; }
        if (match[2]) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(`id: 1\nevent: phase\ndata: ${JSON.stringify({ phase: job.currentPhase, message: "Fixture", progress: null })}\n\n`);
          if (job.status !== "running") res.end(`id: 2\nevent: done\ndata: ${JSON.stringify({ job })}\n\n`);
          else if (job.id === sessionJob.id) { authClients.add(res); req.on("close", () => authClients.delete(res)); }
          return;
        }
        json(res, 200, job); return;
      }
      const file = path.resolve(root, "dist", url.pathname === "/" ? "index.html" : `.${url.pathname}`);
      if (!file.startsWith(path.join(root, "dist") + path.sep)) { res.writeHead(403); res.end(); return; }
      const content = await fs.readFile(file);
      res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html" });
      res.end(content);
    } catch (error) { json(res, error.status || 500, { error: error.message, code: error.code }); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { manager, mutate, jobs, url: `http://127.0.0.1:${server.address().port}`, authRequests: () => authRequests,
    holdAuth: () => { holdAuth = true; }, authPending: () => sessionJob.status === "running",
    finishAuth: () => { holdAuth = false; sessionJob.status = "success"; for (const res of authClients) res.end(`id: 2\nevent: done\ndata: ${JSON.stringify({ job: sessionJob })}\n\n`); authClients.clear(); },
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}

test("queue UI: live editing, reload, mixed results, desktop/mobile and recovery", { timeout: 60000 }, async () => {
  const f = await fixture();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await f.mutate("create");
    for (let i = 0; i < 10; i++) await f.mutate("add", { config: {
      url: `https://fixture.blackboard.invalid/ultra/courses/_14390_1/scorm/overview/_${689299 + i}_1`,
      title: i === 0 ? "Bastionado de redes y sistemas — fundamentos, estrategias y procedimientos de seguridad" : `Unidad ${i + 1}`,
      parentTitle: i % 2 ? "Seguridad de sistemas" : "Universidad", paidPlan: true,
    } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: "es-ES", reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("scorm-notion-lang", "es"));
    const page = await context.newPage(); const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(f.url);
    await page.getByRole("heading", { name: "Tus temarios, en orden" }).waitFor();
    await page.getByRole("button", { name: "Iniciar cola", exact: true }).click();
    await until(() => f.jobs.length === 1);
    await page.getByText("Publicación actual", { exact: true }).waitFor();
    const checksAtStart = f.authRequests();
    await page.reload(); await page.getByText("Publicación actual", { exact: true }).waitFor();
    assert.equal(f.jobs.length, 1);
    assert.equal(f.authRequests(), checksAtStart, "Reload must defer session checks while queue is active");
    await page.getByRole("button", { name: "Quitar", exact: true }).last().click();
    await page.getByText("9 de 10 plazas", { exact: true }).waitFor();
    await page.getByLabel(/^URL de Blackboard/).fill("https://fixture.blackboard.invalid/ultra/courses/_14390_1/scorm/overview/_999999_1");
    await page.getByLabel("Título de la página nueva", { exact: true }).fill("Publicación añadida sobre la marcha");
    await page.getByRole("button", { name: "Añadir a la cola", exact: true }).click();
    await page.getByText("10 de 10 plazas", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Editar", exact: true }).last().click();
    await page.locator("form").getByLabel("Página padre en Notion", { exact: true }).fill("Destino editado");
    await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await page.getByText("Destino: Destino editado", { exact: true }).waitFor();
    const artifacts = path.join(root, "artifacts", "queue-ui"); await fs.mkdir(artifacts, { recursive: true });
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector("ol.overflow-y-auto")?.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(artifacts, "desktop-running.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(artifacts, "mobile-running.png"), fullPage: true, animations: "disabled" });
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.tagName !== "BODY"), true);
    await page.setViewportSize({ width: 1440, height: 1050 });
    for (let i = 0; i < 10; i++) {
      await until(() => f.jobs.length > i);
      const job = f.jobs[i];
      if (i === 2) {
        await job.onCheckpoint({ stage: "page-created", pageId: "partial", pageUrl: "https://www.notion.so/partial" });
        job.finish("failed", { error: "Simulated append failure", errorCode: "job-failed" });
      } else if (i === 3) job.finish("failed", { error: "Simulated unavailable SCORM", errorCode: "job-failed" });
      else job.finish("success", { summary: { title: job.envOverrides.NOTION_PAGE_TITLE, lessons: 14, images: 58, videos: 6 }, finalUrl: `https://www.notion.so/fixture-${i}` });
    }
    await page.getByRole("heading", { name: "Resumen del lote", exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Abrir en Notion", exact: true }).count(), 9);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(artifacts, "desktop-summary.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Reintentar", exact: true }).first().click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByRole("heading", { name: "Revisar antes de reintentar" }).count(), 1);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(f.jobs.length, 10);
    await page.reload(); await page.getByRole("heading", { name: "Resumen del lote", exact: true }).waitFor();
    assert.equal(f.jobs.length, 10);
    await page.getByRole("button", { name: "Nuevo lote", exact: true }).click();
    await page.getByRole("heading", { name: "Preparar publicación", exact: true }).waitFor();
    await page.locator("form").getByLabel(/^URL de Blackboard/).fill("https://fixture.blackboard.invalid/ultra/courses/_14390_1/scorm/overview/_777_1");
    await page.getByRole("button", { name: "Añadir a la cola", exact: true }).click();
    await page.getByRole("button", { name: "Iniciar cola", exact: true }).click();
    await until(() => f.jobs.length === 11);
    f.jobs[10].finish("failed", { errorCode: "session-required", error: "Blackboard bootstrap requires login." });
    await page.getByRole("button", { name: "Iniciar sesión y reanudar", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    f.holdAuth();
    await page.getByRole("button", { name: "Abrir Blackboard", exact: true }).click();
    await until(() => f.authPending());
    await page.reload();
    await page.getByRole("button", { name: "Cancelar", exact: true }).waitFor();
    f.finishAuth();
    await until(() => f.jobs.length === 12);
    f.jobs[11].finish("success", { summary: { title: "Título automático del temario", lessons: 1 }, finalUrl: "https://www.notion.so/auto" });
    await page.getByRole("heading", { name: "Resumen del lote", exact: true }).waitFor();
    await page.getByText("Título automático del temario", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await f.close(); }
});
