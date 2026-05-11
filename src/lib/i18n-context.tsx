import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LANGS, translate, type Lang, type StringKey } from "./i18n";

const STORAGE_KEY = "scorm-notion-lang";

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitial(): Lang {
  if (typeof window === "undefined") {
    return "es";
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (LANGS as ReadonlyArray<string>).includes(stored)) {
      return stored as Lang;
    }
  } catch {
    // localStorage may be unavailable (private mode); fall through
  }
  const nav = window.navigator.language || "es";
  return nav.toLowerCase().startsWith("en") ? "en" : "es";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectInitial());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore quota / privacy errors
    }
    document.documentElement.setAttribute("lang", lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: StringKey, vars?: Record<string, string | number>) =>
      translate(key, lang, vars),
    [lang],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t }),
    [lang, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n debe usarse dentro de <I18nProvider>");
  }
  return ctx;
}

export function useT() {
  return useI18n().t;
}

export function useLang() {
  const { lang, setLang } = useI18n();
  return [lang, setLang] as const;
}
