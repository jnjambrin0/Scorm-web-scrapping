import { waitForFrame } from "../scorm/navigation.mjs";

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_FAILURES = new Set(["timeout", "network-or-policy", "frame-navigation"]);

function safeRoute(value) {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
  catch { return null; }
}

function httpCategory(status) {
  if (status === 401) return "session-required";
  if (status === 403) return "http-forbidden";
  if (status === 404 || status === 410) return "http-not-found";
  if (status === 429) return "rate-limited";
  return "http-error";
}

async function fetchInFrame(frame, asset, timeoutMs) {
  let transportCode = null;
  const page = frame.page();
  const failed = (request) => {
    try {
      if (request.frame() === frame && request.url() === asset.absoluteUrl) {
        transportCode = request.failure()?.errorText?.match(/net::ERR_[A-Z_]+/)?.[0] || null;
      }
    } catch { /* A detached request can no longer expose its frame. */ }
  };
  page.on("requestfailed", failed);
  try {
    const response = await frame.evaluate(async ({ url, kind, timeout, expectedFrameUrl }) => {
      const route = (value) => { try { const u = new URL(value); return `${u.origin}${u.pathname}`; } catch { return null; } };
      const observed = { requestedUrl: route(url), frameUrl: route(location.href), documentBase: route(document.baseURI) };
      if (route(location.href) !== route(expectedFrameUrl) || /\/scormdriver(?:\/|$)/i.test(location.pathname)) {
        return { ok: false, category: "frame-navigation", ...observed };
      }
      if (new URL(url).origin !== location.origin) return { ok: false, category: "source-origin-mismatch", ...observed };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let meta = observed;
      try {
        const response = await fetch(url, { credentials: "include", signal: controller.signal });
        const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
        const retryAfter = response.headers.get("retry-after");
        const retryAfterMs = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())) : 0;
        meta = { ...observed, status: response.status, finalUrl: route(response.url), mime, retryAfterMs };
        const final = new URL(response.url);
        const login = /(^|\.)login\.microsoftonline\.com$/i.test(final.hostname) || /\/(?:login|signin|sign-in)(?:[/.]|$)/i.test(final.pathname);
        if (!response.ok || login) {
          await response.body?.cancel().catch(() => {});
          return { ok: false, ...(login ? { category: "session-required" } : {}), ...meta };
        }
        const expectedMime = !mime || mime === "application/octet-stream" ||
          (kind === "image" ? mime.startsWith("image/") : kind === "video" ? mime.startsWith("video/") : true);
        if (!expectedMime || mime === "text/html" || mime === "application/xhtml+xml") {
          await response.body?.cancel().catch(() => {});
          return { ok: false, category: "unexpected-content", ...meta };
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const prefix = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
        if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(prefix)) return { ok: false, category: "unexpected-content", ...meta };
        if (!bytes.length) return { ok: false, category: "empty-response", ...meta };
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        }
        return { ok: true, ...meta, base64: btoa(binary) };
      } catch {
        return { ok: false, category: controller.signal.aborted ? "timeout" : "network-or-policy", ...meta };
      } finally { clearTimeout(timer); }
    }, { url: asset.absoluteUrl, kind: asset.kind, timeout: timeoutMs, expectedFrameUrl: frame.url() });
    return { ...response, transportCode };
  } catch (error) {
    return {
      ok: false,
      category: page.isClosed() ? "browser-closed" : /Execution context was destroyed|Frame was detached|frame has been detached|Cannot find context/i.test(error.message) ? "frame-navigation" : "browser-error",
      transportCode, requestedUrl: safeRoute(asset.absoluteUrl), frameUrl: safeRoute(frame.url()),
    };
  } finally { page.off("requestfailed", failed); }
}

export async function downloadAssetFromPlayer(player, asset, {
  timeoutMs = 120000,
  frameTimeoutMs = 20000,
  retryDelays = [500, 1500],
} = {}) {
  const attempts = [];
  let response;
  // At most three requests. Reacquire the current content frame each time; a
  // failed evaluation may belong to a frame that navigated or was replaced.
  const delays = retryDelays.slice(0, 2);
  for (let index = 0; index <= delays.length; index++) {
    try {
      const frame = await waitForFrame(player, { timeout: frameTimeoutMs });
      response = await fetchInFrame(frame, asset, timeoutMs);
    } catch {
      response = { ok: false, category: player.context().pages().some((p) => !p.isClosed()) ? "content-not-ready" : "browser-closed" };
    }
    const category = response.ok ? "downloaded" : response.category || httpCategory(response.status);
    attempts.push({ number: index + 1, category, status: response.status || null, transportCode: response.transportCode || null });
    response.diagnostic = {
      category, requestedUrl: safeRoute(asset.absoluteUrl), finalUrl: response.finalUrl || null,
      frameUrl: response.frameUrl || null, documentBase: response.documentBase || null,
      attempts: [...attempts],
    };
    if (response.ok || index === delays.length) break;
    const policyBlocked = /ERR_(?:BLOCKED_BY|ACCESS_DENIED)/.test(response.transportCode || "");
    const retryable = !policyBlocked && (RETRYABLE_FAILURES.has(category) || (!response.category && RETRYABLE_HTTP.has(response.status)));
    // Respect long server backoffs by returning control instead of retrying too early.
    if (!retryable || response.retryAfterMs > 30000) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(delays[index], response.retryAfterMs || 0)));
  }
  return response;
}
