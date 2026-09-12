const SCORM_OVERVIEW_PATTERN =
  /^\/ultra\/courses\/([^/]+)\/((?:[^/]+\/)*)scorm\/overview\/([^/]+)(?:\/.*)?$/i;

function decodePathPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodePathPart(value) {
  return encodeURIComponent(value).replace(/%5F/gi, "_");
}

export function parseScormUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
    parsed.hash = "";
  } catch {
    return null;
  }

  const match = parsed.pathname.match(SCORM_OVERVIEW_PATTERN);
  if (!match) {
    return null;
  }

  const courseId = decodePathPart(match[1]);
  const itemId = decodePathPart(match[3]);
  const identity = `${parsed.origin}/ultra/courses/${encodePathPart(
    courseId,
  )}/scorm/overview/${encodePathPart(itemId)}`;

  return {
    inputUrl: parsed.href,
    origin: parsed.origin,
    courseId,
    itemId,
    route: match[2].replace(/\/$/, "") || "default",
    identity,
  };
}

export function isDirectScormUrl(value) {
  return !!parseScormUrl(value);
}

export function scormSourceIdentity(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    return parsed.href;
  } catch {
    return "";
  }
}

export function matchingScormTargetIndexes(hrefs, pageUrl, target) {
  if (!Array.isArray(hrefs) || !target) return [];

  return hrefs.flatMap((href, index) => {
    if (typeof href !== "string" || !href.trim()) return [];
    try {
      const resolved = new URL(href, pageUrl);
      const candidate = parseScormUrl(resolved.href);
      return candidate?.origin === target.origin && candidate.identity === target.identity
        ? [index]
        : [];
    } catch {
      return [];
    }
  });
}
