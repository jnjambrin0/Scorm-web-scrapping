import type { StringKey } from "./i18n";

export interface ValidationResult {
  ok: boolean;
  messageKey?: StringKey;
}

const OK: ValidationResult = { ok: true };

export function validateBlackboardUrl(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, messageKey: "validation.url.required" };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, messageKey: "validation.url.malformed" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, messageKey: "validation.url.protocol" };
  }
  if (!parsed.host) {
    return { ok: false, messageKey: "validation.url.host" };
  }
  return OK;
}

const UUID_DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_DASHLESS = /^[0-9a-f]{32}$/i;

export function validateNotionUuid(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return OK; // optional field
  }
  if (UUID_DASHED.test(trimmed) || UUID_DASHLESS.test(trimmed)) {
    return OK;
  }
  return { ok: false, messageKey: "validation.uuid.malformed" };
}
