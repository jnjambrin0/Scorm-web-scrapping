import { spawn } from "node:child_process";
import path from "node:path";

import { ROOT } from "../shared/paths.mjs";
const VITE_BIN = path.join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);

const children = [];

function prefixLines(name, stream) {
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString("utf8");
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) {
        console.log(`[${name}] ${line}`);
      }
    }
  });
  stream.on("end", () => {
    if (pending.trim()) {
      console.log(`[${name}] ${pending}`);
    }
  });
}

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  prefixLines(name, child.stdout);
  prefixLines(name, child.stderr);
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    console.error(
      `[${name}] exited unexpectedly with ${signal || `code ${code ?? 0}`}`,
    );
    shutdown(code || 1);
  });
}

let shuttingDown = false;
function shutdown(exitCode = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  }
  setTimeout(() => process.exit(exitCode), 300).unref();
}

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

start("api", process.execPath, ["scripts/web-server.mjs"]);
start("vite", VITE_BIN, ["--host", "127.0.0.1"]);

console.log("Local app starting:");
console.log("  UI:  Vite will print the exact local URL below.");
console.log("  API: http://127.0.0.1:8787");
