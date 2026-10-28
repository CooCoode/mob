export const FILE_CHUNK = 4 * 1024 * 1024;

/** A stored/server-provided URL may never redirect a machine credential elsewhere. */
export function tusURL(base: string, value: string, creation = false): string {
  const root = new URL(`${base.replace(/\/+$/, "")}/file-uploads/`);
  const url = new URL(value, root);
  const id = url.pathname.slice(root.pathname.length);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || url.search || url.hash ||
      url.username || url.password || !(creation && id === "" || /^[a-f0-9]{32}$/.test(id))) {
    throw new Error("Invalid upload location returned by mobd");
  }
  return url.href;
}

export function checkFileRange(status: number, range: string | null, etag: string | null, expectedETag: string, start: number, end: number, size: number): void {
  if (status === 412 || etag !== expectedETag) throw new Error("Remote file changed. Cancel this download and download the new version.");
  if (status !== 206 || range !== `bytes ${start}-${end}/${size}`) throw new Error("mobd returned an invalid download range");
}
