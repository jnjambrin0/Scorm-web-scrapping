import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";
import { useT } from "../lib/i18n-context";
import {
  MEDIA_WIDTH_RATIO_MAX,
  MEDIA_WIDTH_RATIO_MIN,
  MEDIA_WIDTH_RATIO_STEP,
  type Settings,
} from "../lib/settings";
import type { ConfigStatus } from "../lib/types";
import { Field } from "./Field";
import { Switch } from "./Switch";
import { Slider } from "./Slider";
import { Button } from "./Button";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  update: <K extends keyof Settings>(section: K, partial: Partial<Settings[K]>) => void;
  reset: () => void;
  config: ConfigStatus | null;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-caption2 font-semibold uppercase tracking-[0.06em] text-ink-muted">
      {children}
    </p>
  );
}

function SectionDivider() {
  return <div className="my-6 border-t border-line-soft" aria-hidden="true" />;
}

export function SettingsModal({
  open,
  onClose,
  settings,
  update,
  reset,
  config,
}: Props) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Drive the native <dialog> imperatively. showModal() vs close() handles the
  // top-layer + focus trap + ESC handling for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // ESC fires a `cancel` event on the dialog by default; intercept so React
  // state stays in sync with the visible state.
  function handleCancel(event: Event) {
    event.preventDefault();
    onClose();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click outside the content (i.e. on the backdrop, which is the dialog
  // element itself) closes the modal.
  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) {
      onClose();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal scrollbar-quiet"
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
    >
      <div className="flex max-h-[calc(100vh-4rem)] flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line-soft bg-surface px-6 py-4">
          <h2 id={titleId} className="text-title3 font-semibold text-ink">
            {t("settings.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("settings.close")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-fast ease-standard hover:bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-5">
          <SectionLabel>{t("settings.section.formDefaults")}</SectionLabel>
          <div className="grid gap-4">
            <Field
              label={t("settings.formDefaults.parentTitle.label")}
              hint={t("settings.formDefaults.parentTitle.hint")}
              value={settings.formDefaults.notionParentPageTitle}
              onChange={(v) => update("formDefaults", { notionParentPageTitle: v })}
              autoComplete="off"
            />
            <Field
              label={t("settings.formDefaults.parentId.label")}
              hint={t("settings.formDefaults.parentId.hint")}
              placeholder="00000000-0000-0000-0000-000000000000"
              value={settings.formDefaults.notionParentPageId}
              onChange={(v) => update("formDefaults", { notionParentPageId: v })}
              autoComplete="off"
              spellCheck={false}
            />
            <Switch
              label={t("settings.formDefaults.refresh.label")}
              hint={t("settings.formDefaults.refresh.hint")}
              checked={settings.formDefaults.refresh}
              onChange={(v) => update("formDefaults", { refresh: v })}
            />
            <Switch
              label={t("settings.formDefaults.deleteAfter.label")}
              hint={t("settings.formDefaults.deleteAfter.hint")}
              checked={settings.formDefaults.deleteAfter}
              onChange={(v) => update("formDefaults", { deleteAfter: v })}
            />
          </div>

          <SectionDivider />

          <SectionLabel>{t("settings.section.notion")}</SectionLabel>
          <Slider
            label={t("settings.notion.mediaWidthRatio.label")}
            hint={t("settings.notion.mediaWidthRatio.hint")}
            min={MEDIA_WIDTH_RATIO_MIN}
            max={MEDIA_WIDTH_RATIO_MAX}
            step={MEDIA_WIDTH_RATIO_STEP}
            value={settings.notion.mediaWidthRatio}
            onChange={(v) => update("notion", { mediaWidthRatio: v })}
          />

          <SectionDivider />

          <SectionLabel>{t("settings.section.system")}</SectionLabel>
          <SystemInfoRow
            name={t("settings.system.notionKey")}
            status={config?.hasNotionApiKey ?? false}
            setLabel={t("settings.system.notionKey.set")}
            unsetLabel={t("settings.system.notionKey.unset")}
          />
          <SystemInfoRow
            name={t("settings.system.blackboardUrl")}
            status={config?.hasBlackboardBaseUrl ?? false}
            setLabel={config?.blackboardBaseUrl ?? ""}
            unsetLabel={t("settings.system.notionKey.unset")}
            mono
          />
          <p className="mt-3 text-caption1 leading-snug text-ink-muted">
            {t("settings.system.editNote")}
          </p>
        </div>

        <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line-soft bg-surface px-6 py-4">
          <Button
            variant="ghost"
            size="sm"
            label={t("settings.reset")}
            onClick={reset}
          />
          <Button
            variant="primary"
            tone="accent"
            size="md"
            label={t("settings.done")}
            onClick={onClose}
          />
        </footer>
      </div>
    </dialog>
  );
}

interface SystemInfoRowProps {
  name: string;
  status: boolean;
  setLabel: string;
  unsetLabel: string;
  mono?: boolean;
}

function SystemInfoRow({ name, status, setLabel, unsetLabel, mono }: SystemInfoRowProps) {
  const Icon = status ? CheckCircle2 : Circle;
  const iconClass = status ? "text-success" : "text-ink-faint";
  const valueText = status ? setLabel : unsetLabel;
  const valueClass = mono ? "font-mono text-caption1 break-all" : "text-footnote";
  return (
    <div className="mt-2 flex items-start gap-3 first:mt-0">
      <Icon
        className={["mt-0.5 h-4 w-4 shrink-0", iconClass].join(" ")}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-footnote font-medium text-ink">{name}</p>
        <p className={["mt-0.5 text-ink-muted", valueClass].join(" ")}>
          {valueText || (status ? setLabel : unsetLabel)}
        </p>
      </div>
    </div>
  );
}
