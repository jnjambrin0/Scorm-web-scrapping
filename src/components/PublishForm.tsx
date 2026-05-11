import type { ReactNode } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import type { Command } from "../lib/types";
import { useT } from "../lib/i18n-context";
import type { UseFormState, FieldKey } from "../hooks/useFormState";
import { Card } from "./Card";
import { Field } from "./Field";
import { Switch } from "./Switch";
import { Disclosure } from "./Disclosure";
import { Button } from "./Button";

interface Props {
  form: UseFormState;
  disabled: boolean;
  loadingCommand: Command | null;
  onSubmit: (command: Command) => void;
}

function fieldId(key: FieldKey): string {
  return `field-${key}`;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-caption2 font-semibold uppercase tracking-[0.06em] text-ink-muted">
      {children}
    </p>
  );
}

function SectionDivider() {
  return <div className="my-7 border-t border-line-soft" aria-hidden="true" />;
}

export function PublishForm({ form, disabled, loadingCommand, onSubmit }: Props) {
  const t = useT();
  const { values, errors, update, blur } = form;

  const errorFor = (key: FieldKey): string | undefined => {
    const messageKey = errors[key];
    return messageKey ? t(messageKey) : undefined;
  };

  return (
    <Card tone="neutral" elevation={2} padding="xl">
      <header className="mb-7">
        <h1 className="text-title1 font-semibold tracking-tight text-ink">
          {t("hero.title")}
        </h1>
        <p className="mt-1.5 max-w-prose text-subhead text-ink-muted">
          {t("hero.subtitle")}
        </p>
      </header>

      <SectionLabel>{t("section.source")}</SectionLabel>
      <div id={fieldId("courseOutlineUrl")}>
        <Field
          label={t("field.courseUrl.label")}
          hint={t("field.courseUrl.help")}
          placeholder={t("field.courseUrl.placeholder")}
          value={values.courseOutlineUrl}
          onChange={(v) => update("courseOutlineUrl", v)}
          onBlur={() => blur("courseOutlineUrl")}
          error={errorFor("courseOutlineUrl")}
          size="lg"
          disabled={disabled}
          required
          autoComplete="url"
          spellCheck={false}
        />
      </div>

      <SectionDivider />

      <SectionLabel>{t("section.destination")}</SectionLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("field.parentTitle.label")}
          hint={t("field.parentTitle.help")}
          placeholder={t("field.parentTitle.placeholder")}
          value={values.notionParentPageTitle}
          onChange={(v) => update("notionParentPageTitle", v)}
          disabled={disabled}
        />
        <Field
          label={t("field.pageTitle.label")}
          hint={t("field.pageTitle.help")}
          placeholder={t("field.pageTitle.placeholder")}
          value={values.notionPageTitle}
          onChange={(v) => update("notionPageTitle", v)}
          disabled={disabled}
        />
      </div>

      <SectionDivider />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button
          variant="primary"
          tone="accent"
          size="lg"
          fullWidth
          label={t("action.publish")}
          icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
          onClick={() => onSubmit("notion-publish")}
          disabled={disabled}
          loading={loadingCommand === "notion-publish"}
        />
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          label={t("action.dryrun")}
          icon={<ChevronRight className="h-5 w-5" aria-hidden="true" />}
          onClick={() => onSubmit("notion-dry-run")}
          disabled={disabled}
          loading={loadingCommand === "notion-dry-run"}
        />
      </div>

      <div className="mt-6">
        <Disclosure
          title={t("advanced.title")}
          subtitle={t("advanced.subtitle")}
        >
          <div className="grid gap-4">
            <Switch
              label={t("field.refresh.label")}
              hint={t("field.refresh.help")}
              checked={values.refresh}
              onChange={(v) => update("refresh", v)}
              disabled={disabled}
            />
            <Switch
              label={t("field.deleteAfter.label")}
              hint={t("field.deleteAfter.help")}
              checked={values.deleteAfter}
              onChange={(v) => update("deleteAfter", v)}
              disabled={disabled}
            />
            <Field
              label={t("field.unit.label")}
              hint={t("field.unit.help")}
              placeholder={t("field.unit.placeholder")}
              value={values.scormTitle}
              onChange={(v) => update("scormTitle", v)}
              disabled={disabled}
            />
            <div id={fieldId("notionParentPageId")}>
              <Field
                label={t("field.parentId.label")}
                help={t("field.parentId.help")}
                placeholder={t("field.parentId.placeholder")}
                value={values.notionParentPageId}
                onChange={(v) => update("notionParentPageId", v)}
                onBlur={() => blur("notionParentPageId")}
                error={errorFor("notionParentPageId")}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Field
              label={t("field.markdownOut.label")}
              hint={t("field.markdownOut.help")}
              placeholder={t("field.markdownOut.placeholder")}
              value={values.markdownOutput}
              onChange={(v) => update("markdownOutput", v)}
              disabled={disabled}
            />
          </div>
        </Disclosure>
      </div>
    </Card>
  );
}

export function focusFormField(key: FieldKey) {
  const root = document.getElementById(fieldId(key));
  if (!root) return;
  root.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = root.querySelector("input");
  input?.focus({ preventScroll: true });
}
