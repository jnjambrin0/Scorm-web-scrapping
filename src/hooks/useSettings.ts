import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  sanitizeSettings,
  type Settings,
} from "../lib/settings";

export interface UseSettings {
  settings: Settings;
  update: <K extends keyof Settings>(section: K, partial: Partial<Settings[K]>) => void;
  reset: () => void;
}

/**
 * React adapter around the localStorage settings store. Reads once on mount,
 * persists on every change. Components only see the latest immutable snapshot.
 */
export function useSettings(): UseSettings {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  // Skip persisting on the first render — that value already came from storage
  // (or is exactly DEFAULT_SETTINGS), so writing it back is wasted work and
  // would mask a corrupted-storage scenario by overwriting it with defaults.
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    saveSettings(settings);
  }, [settings]);

  const update = useCallback<UseSettings["update"]>((section, partial) => {
    setSettings((current) =>
      sanitizeSettings({
        ...current,
        [section]: { ...current[section], ...partial },
      }),
    );
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return { settings, update, reset };
}
