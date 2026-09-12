import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export function fileQueueStore(filename) {
  const lockDirectory = `${filename}.writer`;
  const ownerFile = `owner-${process.pid}-${crypto.randomUUID()}`;
  let ownsLock = false;
  const busy = () => Object.assign(new Error("Otra instancia de la aplicación está usando esta cola."), { code: "queue-owner" });
  return {
    async acquire() {
      await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.mkdir(lockDirectory, { mode: 0o700 });
          await fs.writeFile(path.join(lockDirectory, ownerFile), "", { flag: "wx", mode: 0o600 });
          ownsLock = true; return;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
        const entries = await fs.readdir(lockDirectory).catch(() => []);
        const owner = entries.length === 1 && entries[0].match(/^owner-(\d+)-[a-f0-9-]+$/);
        if (!owner) throw busy();
        try { process.kill(Number(owner[1]), 0); throw busy(); } catch (error) { if (error.code !== "ESRCH") throw busy(); }
        // Only the contender that removes this dead owner's unique file may
        // remove its directory. Never unlink a newer writer's ownership file.
        try { await fs.unlink(path.join(lockDirectory, entries[0])); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
        await fs.rmdir(lockDirectory).catch((error) => { if (error.code !== "ENOENT") throw error; });
      }
      throw busy();
    },
    async release() {
      if (!ownsLock) return;
      ownsLock = false;
      try { await fs.unlink(path.join(lockDirectory, ownerFile)); } catch (error) { if (error.code === "ENOENT") return; throw error; }
      await fs.rmdir(lockDirectory);
    },
    async load() {
      try {
        const state = JSON.parse(await fs.readFile(filename, "utf8"));
        if (!state || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.batches) || !state.operations || typeof state.operations !== "object" ||
          state.batches.some((batch) => !batch?.id || !["draft", "running", "paused", "completed", "stopped"].includes(batch.status) || !Array.isArray(batch.items) || batch.items.length > 10 ||
            batch.items.some((item) => !item?.id || typeof item.config?.url !== "string" || !Array.isArray(item.attempts) ||
              !["pending", "running", "success", "failed", "cancelled", "incomplete", "interrupted", "blocked"].includes(item.status) ||
              (item.status === "running" && item.attempts.length === 0) || item.attempts.some((attempt) => !attempt?.id || !attempt.jobId || typeof attempt.startedAt !== "string")))) {
          throw new Error("Invalid queue schema");
        }
        return state;
      } catch (error) {
        if (error.code === "ENOENT") return { schemaVersion: 1, revision: 0, batches: [], operations: {} };
        throw new Error("No se puede leer la cola guardada. Conserva el archivo y revisa el almacenamiento.");
      }
    },
    async save(state) {
      const directory = path.dirname(filename);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
      try {
        const file = await fs.open(temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
        await fs.rename(temporary, filename);
        const dir = await fs.open(directory, "r");
        try { await dir.sync(); } finally { await dir.close(); }
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
    },
  };
}
