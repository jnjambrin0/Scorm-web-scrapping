export interface SessionVerificationSnapshot {
  verified: true;
  checkedAt: string;
  destination: "blackboard";
}

export const SESSION_VERIFICATION_STORAGE_KEY = "scorm-notion:session-verification";

export interface AutomaticSessionCheckInput {
  alreadyFired: boolean;
  bootstrapReady: boolean;
  jobBootstrapped: boolean;
  sessionBootstrapped: boolean;
  jobRunning: boolean;
  sessionBusy: boolean;
  hasBlackboardBaseUrl: boolean;
}

export function shouldStartAutomaticSessionCheck(input: AutomaticSessionCheckInput): boolean {
  return Boolean(
    !input.alreadyFired &&
      input.bootstrapReady &&
      input.jobBootstrapped &&
      input.sessionBootstrapped &&
      !input.jobRunning &&
      !input.sessionBusy &&
      input.hasBlackboardBaseUrl,
  );
}

export function loadSessionVerification(): SessionVerificationSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(SESSION_VERIFICATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionVerificationSnapshot>;
    const checkedAt = typeof parsed.checkedAt === "string" ? new Date(parsed.checkedAt) : null;
    if (
      parsed.verified !== true ||
      parsed.destination !== "blackboard" ||
      !checkedAt ||
      Number.isNaN(checkedAt.getTime())
    ) {
      return null;
    }
    return {
      verified: true,
      checkedAt: checkedAt.toISOString(),
      destination: "blackboard",
    };
  } catch {
    return null;
  }
}

export function saveSessionVerification(checkedAt = new Date()): SessionVerificationSnapshot {
  const snapshot: SessionVerificationSnapshot = {
    verified: true,
    checkedAt: checkedAt.toISOString(),
    destination: "blackboard",
  };
  if (typeof window === "undefined") return snapshot;

  try {
    window.localStorage.setItem(SESSION_VERIFICATION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage is a visual continuity optimization, never an auth dependency.
  }
  return snapshot;
}

export function clearSessionVerification(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_VERIFICATION_STORAGE_KEY);
  } catch {
    // localStorage is optional and must never block session recovery.
  }
}
