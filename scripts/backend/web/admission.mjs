export class AdmissionError extends Error {
  constructor(code, message, busy = null) {
    super(message);
    this.code = code;
    this.status = 409;
    this.busy = busy;
  }
}

export function createAdmission({ active, inspect, create, serialize, reuse, reserved = () => false }) {
  let tail = Promise.resolve();
  let stopped = false;
  return {
    stop() { stopped = true; },
    start(request, { queue = false, beforeStart = async () => {} } = {}) {
      const operation = tail.then(async () => {
        if (stopped) throw new AdmissionError("shutdown", "El servidor se está cerrando.");
        const job = active();
        if (job) {
          if (!queue && reuse(request.command, request.flags, job)) return job;
          throw new AdmissionError("application-job", "Hay una tarea de Blackboard aún activa.", { source: "application-job", job: serialize(job) });
        }
        if (!queue && reserved()) throw new AdmissionError("queue-active", "La cola está activa. Páusala antes de iniciar otra tarea.");
        const profile = await inspect();
        if (stopped) throw new AdmissionError("shutdown", "El servidor se está cerrando.");
        if (!["available", "stale-lock"].includes(profile.state)) {
          throw new AdmissionError("profile-busy", "El perfil de Blackboard está ocupado. Cierra la ventana externa o espera a la otra tarea.", { source: profile.state, owner: profile.owner });
        }
        await beforeStart();
        if (stopped) throw new AdmissionError("shutdown", "El servidor se está cerrando.");
        return create(request);
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
}
