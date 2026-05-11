export function safeFilename(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 90);
}

export function sanitizeText(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/ntn_[A-Za-z0-9._-]+/g, "ntn_[redacted]")
    .replace(/secret_[A-Za-z0-9._-]+/g, "secret_[redacted]")
    .replace(/([?&](?:X-Amz-Signature|Signature|sig)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(authorization|cookie|set-cookie):\s*[^\n\r]+/gi, "$1: [redacted]");
}

export function sanitizeError(error) {
  return sanitizeText(error?.message || error);
}

export function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
