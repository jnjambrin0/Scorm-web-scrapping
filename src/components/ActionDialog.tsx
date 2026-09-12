import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { useT } from "../lib/i18n-context";

export function ActionDialog({ open, title, children, onClose, onConfirm }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const t = useT();
  useEffect(() => { const d = ref.current; if (!d) return; if (open && !d.open) d.showModal(); if (!open && d.open) d.close(); }, [open]);
  return <dialog ref={ref} className="modal" aria-labelledby={id}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === ref.current) onClose(); }}>
    <div className="p-6 sm:p-8">
      <h2 id={id} className="text-title3 font-semibold">{title}</h2>
      <div className="mt-3 text-subhead leading-relaxed text-ink-soft">{children}</div>
      <footer className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" label={t("queue.cancel")} onClick={onClose} autoFocus />
        <Button label={t("queue.confirm")} onClick={onConfirm} />
      </footer>
    </div>
  </dialog>;
}
