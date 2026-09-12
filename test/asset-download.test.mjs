import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { waitForFrame } from "../scripts/backend/scorm/navigation.mjs";
import { downloadAssetFromPlayer } from "../scripts/backend/notion/asset-download.mjs";
import { collectMediaReferences, downloadAssets } from "../scripts/backend/notion/assets.mjs";

const filename = "INSD_BAST_U03_5.1_Imagen1.jpg";
const jpeg = Buffer.from([255, 216, 255, 217]);
async function fixture(callback, handler = () => false, bootstrap = false) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (handler(req, res)) return;
    res.setHeader("content-type", "text/html");
    if (req.url === "/player") res.end(`<iframe name="scormdriver_content" src="${bootstrap ? "/scormdriver/bootstrap.html" : "/scormcontent/index.html"}"></iframe>`);
    else if (req.url === "/scormdriver/bootstrap.html") res.end('<script>setTimeout(() => location.assign("/scormcontent/index.html"), 180)</script>');
    else if (req.url === "/scormcontent/index.html") res.end('<main>Rise lesson</main>');
    else if (req.url?.startsWith(`/scormcontent/assets/${filename}`)) { res.setHeader("content-type", "image/jpeg"); res.end(jpeg); }
    else { res.writeHead(404); res.end("Not found"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/player`);
    const [asset] = collectMediaReferences(`![](assets/${filename})`, [{ baseUri: `${origin}/scormcontent/index.html` }]);
    await callback({ page, asset, origin, requests });
  } finally { await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
const options = { timeoutMs: 1000, retryDelays: [1, 1], frameTimeoutMs: 1500 };

test("waits past the named driver frame before downloading the reported image", async () => {
  await fixture(async ({ page, asset, requests }) => {
    const frame = await waitForFrame(page, { timeout: 1500 });
    assert.match(frame.url(), /\/scormcontent\/index.html$/);
    const result = await downloadAssetFromPlayer(page, asset, options);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(Buffer.from(result.base64, "base64"), jpeg);
    assert.equal(requests.some((url) => url.startsWith("/scormdriver/assets/")), false);
  }, undefined, true);
});

test("uses the absolute lesson asset URL even when the document base differs", async () => {
  await fixture(async ({ page, asset, requests }) => {
    const frame = await waitForFrame(page, { timeout: 1500 });
    await frame.evaluate(() => { const base = document.createElement("base"); base.href = "/scormdriver/"; document.head.append(base); });
    asset.absoluteUrl += "?token=private-test-value";
    const result = await downloadAssetFromPlayer(page, asset, options);
    assert.equal(result.ok, true);
    assert.ok(requests.includes(`/scormcontent/assets/${filename}?token=private-test-value`));
    assert.equal(JSON.stringify(result.diagnostic).includes("private-test-value"), false);
  });
});

test("retries transient HTTP responses, but a real 404 receives no fallback", async () => {
  let attempts = 0;
  await fixture(async ({ page, asset, requests }) => {
    const result = await downloadAssetFromPlayer(page, asset, options);
    assert.equal(result.ok, true); assert.equal(result.diagnostic.attempts.length, 3);
    const missing = await downloadAssetFromPlayer(page, { ...asset, absoluteUrl: asset.absoluteUrl.replace(filename, "missing.jpg") }, options);
    assert.equal(missing.ok, false); assert.equal(missing.diagnostic.category, "http-not-found");
    assert.equal(missing.diagnostic.attempts.length, 1);
    assert.equal(requests.filter((url) => url.includes("missing.jpg")).length, 1);
  }, (req, res) => {
    if (req.url.includes(filename) && ++attempts < 3) { res.writeHead(503); res.end(); return true; }
    return false;
  });
});

test("distinguishes lost authentication, HTML payloads and missing resources", async () => {
  await fixture(async ({ page, asset, origin }) => {
    const expired = await downloadAssetFromPlayer(page, { ...asset, absoluteUrl: `${origin}/expired` }, options);
    assert.equal(expired.diagnostic.category, "session-required");
    const html = await downloadAssetFromPlayer(page, { ...asset, absoluteUrl: `${origin}/html` }, options);
    assert.equal(html.diagnostic.category, "unexpected-content"); assert.equal(html.base64, undefined);
  }, (req, res) => {
    if (req.url === "/expired") { res.writeHead(401); res.end(); return true; }
    if (req.url === "/html") { res.setHeader("content-type", "application/octet-stream"); res.end("<!doctype html><html>Service error</html>"); return true; }
    return false;
  });
});

test("a stalled request times out with bounded attempts", async () => {
  await fixture(async ({ page, asset, origin }) => {
    const result = await downloadAssetFromPlayer(page, { ...asset, absoluteUrl: `${origin}/stall` }, { ...options, timeoutMs: 40 });
    assert.equal(result.ok, false); assert.equal(result.diagnostic.category, "timeout");
    assert.equal(result.diagnostic.attempts.length, 3);
  }, (req) => req.url === "/stall");
});

test("recovers a frame navigation without changing the asset URL", async () => {
  let first = true;
  await fixture(async ({ page, asset }) => {
    const frame = await waitForFrame(page, { timeout: 1500 });
    page.on("request", (request) => {
      if (first && request.url() === asset.absoluteUrl) { first = false; void frame.goto(frame.url()); }
    });
    const result = await downloadAssetFromPlayer(page, asset, options);
    assert.equal(result.ok, true);
    assert.ok(result.diagnostic.attempts.length > 1);
  }, (req, res) => {
    if (req.url.includes(filename) && first) { setTimeout(() => { if (!res.destroyed) { res.setHeader("content-type", "image/jpeg"); res.end(jpeg); } }, 100); return true; }
    return false;
  });
});

test("persists each asset and leaves previously downloaded resources untouched", async () => {
  await fixture(async ({ page, asset }) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-assets-test-"));
    try {
      const existing = path.join(directory, "existing.jpg"); await fs.writeFile(existing, jpeg);
      const cached = { ...asset, id: 2, status: "downloaded", localPath: existing, sha256: "existing-hash" };
      const saves = [];
      await downloadAssets(page.context(), {}, [cached, asset], {
        assetDir: directory, openPlayer: async () => page,
        saveManifest: async (_export, assets) => saves.push(structuredClone(assets)),
        downloadOptions: options,
      });
      assert.equal(asset.status, "downloaded");
      assert.deepEqual(await fs.readFile(existing), jpeg);
      assert.equal(cached.sha256, "existing-hash");
      assert.ok(saves.some((assets) => assets[1].status === "downloaded"));
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
