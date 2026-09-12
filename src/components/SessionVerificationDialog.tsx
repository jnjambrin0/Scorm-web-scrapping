import { useEffect, useId, useRef, type MouseEvent } from "react";
import { ShieldCheck, X } from "lucide-react";
import { useT } from "../lib/i18n-context";
import { Button } from "./Button";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function SessionVerificationDialog({ open, onClose, onConfirm }: Props) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="surface-tint-info inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-accent">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 id={titleId} className="text-title3 font-semibold text-ink">
              {t("session.dialog.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("session.dialog.cancel")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-fast ease-standard hover:bg-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-5 text-footnote leading-relaxed text-ink-soft">
          {t("session.dialog.body")}
        </p>
        <p className="mt-3 text-caption1 leading-snug text-ink-muted">
          {t("session.dialog.concurrent")}
        </p>
        <footer className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            label={t("session.dialog.cancel")}
            onClick={onClose}
          />
          <Button
            variant="primary"
            tone="accent"
            size="md"
            label={t("session.dialog.confirm")}
            onClick={onConfirm}
          />
        </footer>
      </div>
    </dialog>
  );
}
