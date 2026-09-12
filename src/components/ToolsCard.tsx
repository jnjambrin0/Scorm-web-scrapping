import { FileText, ShieldCheck } from "lucide-react";
import type { Command } from "../lib/types";
import { useT } from "../lib/i18n-context";
import { Button } from "./Button";

interface Props {
  disabled: boolean;
  loadingCommand: Command | null;
  onExportMd: () => void;
  onVerifySession: () => void;
  sessionBusy: boolean;
}

export function ToolsCard({
  disabled,
  loadingCommand,
  onExportMd,
  onVerifySession,
  sessionBusy,
}: Props) {
  const t = useT();
  return (
    <section aria-labelledby="tools-title" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line-soft bg-surface p-5 sm:p-6">
      <header>
        <h2 id="tools-title" className="text-subhead font-semibold text-ink">
          {t("tools.title")}
        </h2>
        <p className="text-caption1 text-ink-muted">{t("tools.subtitle")}</p>
      </header>
      <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
        <Button
          variant="secondary"
          size="md"
          fullWidth
          label={t("session.remoteVerify")}
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          onClick={onVerifySession}
          disabled={disabled}
          loading={sessionBusy}
        />
        <Button
          variant="secondary"
          size="md"
          fullWidth
          label={t("tools.exportMd")}
          icon={<FileText className="h-4 w-4" aria-hidden="true" />}
          onClick={onExportMd}
          disabled={disabled}
          loading={loadingCommand === "export-md"}
        />
      </div>
    </section>
  );
}
