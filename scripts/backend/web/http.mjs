import fs from "node:fs/promises";
import path from "node:path";

import { DIST_DIR } from "../shared/paths.mjs";
import { sanitizeText } from "../shared/text.mjs";

const MAX_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
  [".json", "application/json; charset=utf-8"],
]);

export function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export function writeError(response, statusCode, message) {
  writeJson(response, statusCode, { error: sanitizeText(message) });
}

export function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function serveStatic(request, response, url) {
  if (request.method !== "GET") {
    writeError(response, 405, "Method not allowed.");
    return;
  }

  if (!(await fileExists(DIST_DIR))) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><meta charset=\"utf-8\"><title>SCORM a Notion</title><body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:32px\"><h1>Backend local activo</h1><p>Ejecuta <code>npm run dev</code> y abre <a href=\"http://127.0.0.1:5173\">http://127.0.0.1:5173</a>.</p></body>",
    );
    return;
  }

  const pathname = decodeURIComponent(url.pathname);
  let filePath = path.resolve(DIST_DIR, `.${pathname}`);
  const relativePath = path.relative(DIST_DIR, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    writeError(response, 403, "Forbidden.");
    return;
  }

  const stat = await fs.stat(filePath).catch(() => null);
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
  } else if (!stat?.isFile()) {
    filePath = path.join(DIST_DIR, "index.html");
  }

  const contentType =
    MIME_TYPES.get(path.extname(filePath).toLowerCase()) ||
    "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  response.end(await fs.readFile(filePath));
}
