import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Defaults } from "../lib/types";

export type BootstrapStatus = "loading" | "ready" | "error";

export interface BootstrapState {
  status: BootstrapStatus;
  defaults: Defaults | null;
  error: string | null;
}

export function useDefaultsBootstrap(): BootstrapState {
  const [state, setState] = useState<BootstrapState>({
    status: "loading",
    defaults: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    api
      .defaults()
      .then((defaults) => {
        if (!active) return;
        setState({ status: "ready", defaults, error: null });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          defaults: null,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
