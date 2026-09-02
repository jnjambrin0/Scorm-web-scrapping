const SCORM_OVERVIEW_PATTERN =
  /^\/ultra\/courses\/([^/]+)\/(?:(outline|grades)\/)?scorm\/overview\/([^/]+)(?:\/.*)?$/i;

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
    route: match[2] || "default",
    identity,
    canonicalUrl: canonicalScormUrl(parsed.href),
  };
}

export function canonicalScormUrl(value) {
  const target = parseScormUrlWithoutCanonical(value);
  if (!target) {
    return null;
  }

  const parsed = new URL(target.inputUrl);
  parsed.pathname = `/ultra/courses/${encodePathPart(
    target.courseId,
  )}/outline/scorm/overview/${encodePathPart(target.itemId)}`;
  parsed.searchParams.set("courseId", target.courseId);
  parsed.hash = "";
  return parsed.href;
}

function parseScormUrlWithoutCanonical(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }

  const match = parsed.pathname.match(SCORM_OVERVIEW_PATTERN);
  if (!match) {
    return null;
  }

  return {
    inputUrl: parsed.href,
    courseId: decodePathPart(match[1]),
    itemId: decodePathPart(match[3]),
  };
}

export function isDirectScormUrl(value) {
  return !!parseScormUrl(value);
}

export function canonicalScormIdentity(value) {
  const target = parseScormUrl(value);
  if (target) {
    return target.identity;
  }

  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function scormUrlCandidates(value) {
  const target = parseScormUrl(value);
  if (!target) {
    return [];
  }

  const candidates = [target.inputUrl];
  if (target.canonicalUrl && target.canonicalUrl !== target.inputUrl) {
    candidates.push(target.canonicalUrl);
  }
  return candidates;
}

export function matchingScormTargetIndex(hrefs, pageUrl, target) {
  if (!Array.isArray(hrefs) || !target) {
    return -1;
  }

  for (let index = 0; index < hrefs.length; index += 1) {
    const href = hrefs[index];
    if (typeof href !== "string" || !href.trim()) {
      continue;
    }

    try {
      const candidate = parseScormUrl(new URL(href, pageUrl).href);
      if (candidate?.identity === target.identity) {
        return index;
      }
    } catch {
      // Ignore malformed hrefs and continue looking for the target item.
    }
  }

  return -1;
}
