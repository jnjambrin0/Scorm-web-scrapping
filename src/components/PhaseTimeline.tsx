import { Check, Circle, Loader2 } from "lucide-react";
import { useT } from "../lib/i18n-context";
import type { Command, PhaseKey } from "../lib/types";
import type { UiStatus } from "../hooks/useJob";

const PHASE_KEY_TO_STRING: Record<PhaseKey, `phase.${PhaseKey}`> = {
  starting: "phase.starting",
  markdown: "phase.markdown",
  assets: "phase.assets",
  "notion-parent": "phase.notion-parent",
  upload: "phase.upload",
  "create-page": "phase.create-page",
  "append-blocks": "phase.append-blocks",
  done: "phase.done",
};

interface Props {
  phase: PhaseKey | null;
  status: UiStatus;
  command: Command;
}

const PUBLISH_PHASES: ReadonlyArray<PhaseKey> = [
  "starting",
  "markdown",
  "assets",
  "notion-parent",
  "upload",
  "create-page",
  "append-blocks",
  "done",
];
const DRYRUN_PHASES: ReadonlyArray<PhaseKey> = [
  "starting",
  "markdown",
  "assets",
  "notion-parent",
  "upload",
  "done",
];
const EXPORT_MD_PHASES: ReadonlyArray<PhaseKey> = ["starting", "markdown", "done"];
const MINIMAL_PHASES: ReadonlyArray<PhaseKey> = ["starting", "done"];

function phasesFor(command: Command): ReadonlyArray<PhaseKey> {
  switch (command) {
    case "notion-publish":
      return PUBLISH_PHASES;
    case "notion-dry-run":
      return DRYRUN_PHASES;
    case "export-md":
      return EXPORT_MD_PHASES;
    case "check-session":
    case "login":
      return MINIMAL_PHASES;
  }
}

export function PhaseTimeline({ phase, status, command }: Props) {
  const t = useT();
  const phases = phasesFor(command);
  const currentIndex = phase ? phases.indexOf(phase) : -1;

  return (
    <ol className="scrollbar-quiet -mx-1 flex items-center gap-1 overflow-x-auto px-1 py-1">
      {phases.map((p, idx) => {
        let state: "done" | "active" | "pending";
        if (status === "success") {
          state = "done";
        } else if (status === "running") {
          if (idx < currentIndex) state = "done";
          else if (idx === currentIndex) state = "active";
          else state = "pending";
        } else {
          state = idx < currentIndex ? "done" : "pending";
        }
        const dim =
          (status === "failed" || status === "cancelled") && idx >= currentIndex;
        return (
          <li
            key={p}
            className={[
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption2 font-medium",
              "transition-[background-color,color,border-color] duration-base ease-standard",
              state === "done"
                ? "border-[color-mix(in_srgb,var(--color-success)_35%,transparent)] bg-success-soft text-success"
                : state === "active"
                  ? "border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-accent-soft text-accent"
                  : "border-line bg-surface text-ink-muted",
              dim ? "opacity-[var(--opacity-muted)]" : "",
            ].join(" ")}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span
              className="inline-flex h-3.5 w-3.5 items-center justify-center"
              aria-hidden="true"
            >
              {state === "done" ? (
                <Check className="h-3.5 w-3.5" />
              ) : state === "active" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
            </span>
            <span className="whitespace-nowrap">{t(PHASE_KEY_TO_STRING[p])}</span>
          </li>
        );
      })}
    </ol>
  );
}
