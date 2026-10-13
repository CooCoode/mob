import type { Health, Queue, Session, Upload } from "./types.ts";

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export const fetchHealth = (base: string) => getJSON<Health>(`${base}/health`);

export const fetchQueue = (base: string) => getJSON<Queue>(`${base}/queue`);

export async function fetchArchived(base: string): Promise<Session[]> {
  return (await getJSON<{ sessions: Session[] }>(`${base}/sessions?archived=true`)).sessions;
}

export async function uploadImage(base: string, file: File): Promise<Upload> {
  const form = new FormData();
  form.append("file", file, file.name || "image.png");
  return getJSON<Upload>(`${base}/uploads`, { method: "POST", body: form });
}

export const artifactUrl = (base: string, id: string) => `${base}/artifacts/${encodeURIComponent(id)}`;

export const screenUrl = (base: string, maxWidth: number, nonce: number) =>
  `${base}/screen?maxWidth=${maxWidth}&t=${nonce}`;

export function supports(health: Health | undefined, feature: string): boolean {
  return !!health && health.apiVersion >= 3 && !!health.features?.includes(feature);
}
