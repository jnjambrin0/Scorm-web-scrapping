import { useEffect, useRef } from "react";
import type { LogEntry } from "../lib/types";
import { useT } from "../lib/i18n-context";

interface Props {
  logs: LogEntry[];
  height?: number;
}

const STREAM_COLOR: Record<string, string> = {
  stdout: "text-log-stdout",
  stderr: "text-log-stderr",
  system: "text-log-system",
};

function formatTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Stick-to-bottom threshold in pixels: keep scroll pinned to the latest log
// as long as the user is within this distance from the end. Above it, we
// assume they're inspecting older output and leave their scroll position.
const STICK_THRESHOLD_PX = 32;

export function LogStream({ logs, height = 240 }: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    if (stickToBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [logs]);

  function onScroll() {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickToBottomRef.current = distanceFromBottom < STICK_THRESHOLD_PX;
  }

  if (logs.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-line bg-log-bg-empty text-caption1 text-log-meta"
        style={{ height }}
      >
        {t("job.logsEmpty")}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="scrollbar-quiet overflow-y-auto rounded-md border border-line bg-log-bg px-3 py-2.5 font-mono text-mono"
      style={{ height }}
      role="log"
      aria-live="polite"
    >
      {logs.map((entry) => {
        const stream = entry.stream || "stdout";
        const colorClass = STREAM_COLOR[stream] ?? STREAM_COLOR.stdout;
        return (
          <div key={entry.id} className="flex gap-2 whitespace-pre-wrap break-words">
            <span className="select-none text-log-meta">{formatTime(entry.at)}</span>
            <span className="select-none w-[60px] shrink-0 text-log-meta">
              [{stream}]
            </span>
            <span className={colorClass}>{entry.line}</span>
          </div>
        );
      })}
    </div>
  );
}
