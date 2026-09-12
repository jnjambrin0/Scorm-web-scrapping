import crypto from "node:crypto";

// The parent acknowledges only after durable storage. CLI runs need no IPC.
export async function jobCheckpoint(stage, data = {}) {
  if (!process.send) return;
  if (!process.connected) throw new Error("Queue coordinator disconnected; publication stopped.");
  const requestId = crypto.randomUUID();
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      process.off("message", onMessage);
      process.off("disconnect", onDisconnect);
    };
    const onDisconnect = () => { cleanup(); reject(new Error("Queue coordinator disconnected; publication stopped.")); };
    const onMessage = (message) => {
      if (message?.requestId !== requestId || message?.type !== "checkpoint-ack") return;
      cleanup();
      if (message.ok) resolve();
      else reject(new Error("Queue checkpoint could not be saved; publication stopped."));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Queue checkpoint acknowledgement timed out.")); }, 15000);
    process.on("message", onMessage);
    process.once("disconnect", onDisconnect);
    process.send({ type: "checkpoint", requestId, stage, ...data }, (error) => {
      if (error) { cleanup(); reject(error); }
    });
  });
}
