import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import mobLicense from "../../../LICENSE?raw";
import { Input } from "@/components/ui/input";

interface Package {
  name: string;
  version: string;
  license: string;
  url?: string;
  source: "npm" | "crate";
}

/** mob's own licence, then every third-party package the app ships, grouped by licence (scripts/licenses.mjs). */
export function Licenses() {
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    // Loaded with the About tab, not with the app.
    void import("@/licenses.json").then((m) => setPackages(m.default as Package[]));
  }, []);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const by = new Map<string, Package[]>();
    for (const p of packages ?? []) {
      if (q && !p.name.toLowerCase().includes(q) && !p.license.toLowerCase().includes(q)) continue;
      by.set(p.license, [...(by.get(p.license) ?? []), p]);
    }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [packages, query]);

  return (
    <div className="mt-4 grid gap-2 border-t pt-4">
      <details>
        <summary className="cursor-pointer text-[13px] font-medium">mob licence (MIT)</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-[11px] leading-snug">{mobLicense}</pre>
      </details>
      <p className="text-[13px] font-medium">Open source licences</p>
      <p className="text-xs text-muted-foreground">
        mob is built with these packages ({packages?.length ?? "…"}), each under its own licence. The live desktop uses the WebRTC and
        media decoding built into macOS.
      </p>
      <Input placeholder="Search packages or licences" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8" />
      <div className="grid max-h-72 gap-1 overflow-y-auto pr-1">
        {groups.map(([license, list]) => (
          <details key={license} className="rounded-md border px-2 py-1">
            <summary className="cursor-pointer text-xs">
              <span className="font-medium">{license}</span> <span className="text-muted-foreground">· {list.length}</span>
            </summary>
            <ul className="mt-1 grid gap-0.5 pb-1">
              {list.map((p) => (
                <li key={`${p.source}:${p.name}@${p.version}`} className="flex items-center gap-1.5 text-[11.5px]">
                  <span className="truncate">{p.name}</span>
                  <span className="text-muted-foreground">{p.version}</span>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noreferrer" aria-label={`${p.name} source`} className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
