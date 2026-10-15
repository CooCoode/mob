import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth";

/**
 * Loads a mobd image with the credential into an object URL. The previous image stays
 * until the next one has loaded (no flicker while polling) and is revoked then or on unmount.
 */
export function useAuthedImage(base: string, url: string | null): { src?: string; error: string } {
  const [state, setState] = useState<{ src?: string; error: string }>({ error: "" });
  const current = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    authFetch(base, url, { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const src = URL.createObjectURL(await res.blob());
        if (abort.signal.aborted) {
          URL.revokeObjectURL(src);
          return;
        }
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = src;
        setState({ src, error: "" });
      })
      .catch((err) => {
        if (!abort.signal.aborted) setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => abort.abort();
  }, [base, url]);

  useEffect(() => () => {
    if (current.current) URL.revokeObjectURL(current.current);
  }, []);

  return url ? state : { error: "" };
}
