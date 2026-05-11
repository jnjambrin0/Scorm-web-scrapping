import { useLang, useT } from "../lib/i18n-context";
import type { Lang } from "../lib/i18n";

const OPTIONS: ReadonlyArray<{ value: Lang; label: string }> = [
  { value: "es", label: "ES" },
  { value: "en", label: "EN" },
];

export function LanguageSwitcher() {
  const [lang, setLang] = useLang();
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t("common.lang")}
      className="surface inline-flex items-center gap-0.5 rounded-full p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = lang === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setLang(option.value)}
            aria-pressed={active}
            className={[
              "inline-flex h-7 min-w-[2.25rem] items-center justify-center rounded-full px-2.5 text-caption1 font-semibold",
              "transition-colors duration-fast ease-standard",
              active
                ? "bg-ink text-white"
                : "text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
