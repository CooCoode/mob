export type LinkTarget =
  | { kind: "web"; url: string }
  | { kind: "file"; path: string; display: string }
  | { kind: "anchor"; href: string }
  | { kind: "unsupported"; display: string; reason: string };

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
const unsupported = (display: string, reason: string): LinkTarget => ({ kind: "unsupported", display, reason });

/** Decode once: a file literally named %20 must survive a URL containing %2520. */
function localPath(encoded: string, urlPath = false): LinkTarget {
  let path: string;
  try {
    path = decodeURIComponent(encoded);
  } catch {
    return unsupported(encoded, "This file link contains invalid URL encoding.");
  }
  if (!path || CONTROL.test(path)) return unsupported(encoded, "This file link contains invalid or unsafe characters.");
  if (path.startsWith("//") || path.startsWith("\\\\")) return unsupported(encoded, "This file is on another host and cannot be opened here.");
  if (urlPath && /^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
  // POSIX editor suffixes are explicit conventions; do not strip Windows alternate-stream names.
  const clean = path.startsWith("/") ? path.replace(/:\d+(?::\d+)?$/, "") : path;
  return { kind: "file", path: clean, display: path };
}

/** Classifies Markdown destinations without guessing a working directory or following custom schemes. */
export function classifyLink(href: string | undefined): LinkTarget {
  const raw = href?.trim() ?? "";
  if (!raw) return unsupported("(empty link)", "This link has no destination.");
  if (CONTROL.test(href!)) return unsupported(raw, "This link contains invalid or unsafe characters.");
  if (raw.startsWith("#")) return { kind: "anchor", href: raw };
  if (/^(tauri|file):/i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.username || url.password || url.port || url.search || url.hash) {
        return unsupported(raw, "This file link contains an unsupported host, query or fragment.");
      }
      if (url.protocol === "tauri:" && url.host !== "localhost") {
        return unsupported(raw, "Only local Mob file links can be opened on this device.");
      }
      if (url.protocol === "file:" && url.hostname && url.hostname !== "localhost") {
        return unsupported(raw, "This file is on another host and cannot be opened here.");
      }
      return localPath(url.pathname, true);
    } catch {
      return unsupported(raw, "This file link is malformed.");
    }
  }
  // A //host/path destination is a protocol-relative URL, not a local POSIX path.
  if (raw.startsWith("//") || raw.startsWith("\\\\")) {
    return unsupported(raw, "This link names another host. Use a full HTTP or HTTPS address.");
  }
  if (WINDOWS_PATH.test(raw) || raw.startsWith("/")) return localPath(raw);
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) {
    return unsupported(raw, "This relative link does not identify a file on this device.");
  }
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (!/^https?:\/\//i.test(raw) || url.username || url.password) return unsupported(raw, "This web link is malformed or contains sign-in details.");
      return { kind: "web", url: url.href };
    }
    return unsupported(raw, `The ${url.protocol.slice(0, -1)} link type is not supported.`);
  } catch {
    return unsupported(raw, "This link is malformed or unsupported.");
  }
}
