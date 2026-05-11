const RUN_STARTED_AT = Date.now();

export function elapsedLabel() {
  return `${((Date.now() - RUN_STARTED_AT) / 1000).toFixed(1)}s`;
}

export function logProgress(message) {
  console.error(`[notion-export +${elapsedLabel()}] ${message}`);
}
