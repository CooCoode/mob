import type { ImgHTMLAttributes } from "react";
import { useAuthedImage } from "@/hooks/useAuthedImage";
import { cn } from "@/lib/utils";

/** <img> for a mobd URL: fetched with the device credential. */
export function AuthImage({ base, url, className, ...props }: { base: string; url: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const { src, error } = useAuthedImage(base, url);
  if (!src) return <span className={cn("block min-h-16 min-w-16 bg-muted", error && "bg-danger/10", className)} title={error || undefined} />;
  return <img src={src} {...props} className={className} />;
}
