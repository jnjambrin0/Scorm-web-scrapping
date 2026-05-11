import { FileText } from "lucide-react";
import type { Command } from "../lib/types";
import { useT } from "../lib/i18n-context";
import { Button } from "./Button";

interface Props {
  disabled: boolean;
  loadingCommand: Command | null;
  onExportMd: () => void;
}

export function ToolsCard({ disabled, loadingCommand, onExportMd }: Props) {
  const t = useT();
  return (
    <section aria-labelledby="tools-title">
      <header className="mb-3">
        <h2 id="tools-title" className="text-subhead font-semibold text-ink">
          {t("tools.title")}
        </h2>
        <p className="text-caption1 text-ink-muted">{t("tools.subtitle")}</p>
      </header>
      <div className="grid gap-3 sm:max-w-sm">
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
