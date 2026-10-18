import { useEffect, useRef, useState } from "react";
import { authFetch, responseError } from "@/lib/auth";

export interface AuthedImage {
  src?: string;
  error: string;
  /** When mobd last confirmed the image: a new download or 304 Not Modified. */
  at?: number;
}

/**
 * Loads a mobd image with the credential into an object URL. The previous image stays
 * until the next one has loaded (no flicker while polling) and is revoked then or on unmount.
 * Changing `refresh` loads the URL again, sending the last ETag so an unchanged image is not
 * downloaded.
 */
export function useAuthedImage(base: string, url: string | null, refresh?: number): AuthedImage {
  const [state, setState] = useState<AuthedImage>({ error: "" });
  const current = useRef<string | undefined>(undefined);
  const etag = useRef<{ url: string; tag: string } | null>(null);

  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    const headers: HeadersInit = etag.current?.url === url ? { "If-None-Match": etag.current.tag } : {};
    authFetch(base, url, { signal: abort.signal, headers })
      .then(async (res) => {
        if (res.status === 304) {
          if (!abort.signal.aborted) setState((s) => ({ ...s, error: "", at: Date.now() }));
          return;
        }
        if (!res.ok) throw new Error(await responseError(res));
        const tag = res.headers.get("ETag");
        const src = URL.createObjectURL(await res.blob());
        if (abort.signal.aborted) {
          URL.revokeObjectURL(src);
          return;
        }
        etag.current = tag ? { url, tag } : null;
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = src;
        setState({ src, error: "", at: Date.now() });
      })
      .catch((err) => {
        if (!abort.signal.aborted) setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => abort.abort();
  }, [base, url, refresh]);

  useEffect(() => () => {
    if (current.current) URL.revokeObjectURL(current.current);
  }, []);

  return url ? state : { error: "" };
}
