// Stable wire codes: scheduling never depends on the user's interface language.
export function jobFailureCode(message = "") {
  if (/BROWSER_PROFILE_BUSY|BrowserProfileBusyError|Browser profile is already in use/i.test(message)) return "profile-busy";
  if (/bootstrap.*(?:not authenticated|login)|Blackboard.*(?:login (?:is )?required|session expired|not authenticated)|SESSION_INVALID|SCORM navigation requires.*session|destination:?\s*login|SSO\/login|Authenticated:\s*no/i.test(message)) return "session-required";
  return "job-failed";
}

export function safeDiagnostic(value) {
  return String(value || "").replace(/https?:\/\/[^\s<>"']+/g, (value) => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return "[URL]"; }
  }).slice(0, 2000);
}
