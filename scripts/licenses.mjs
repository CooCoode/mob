// Writes src/licenses.json: every third-party package shipped in the app (npm runtime
// dependencies bundled by Vite, and the Rust crates of the macOS build), for Settings → About.
// Run after changing dependencies: npm run licenses
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const repo = (r) => {
  const u = typeof r === "string" ? r : r?.url;
  if (!u) return undefined;
  return u.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://").replace(/^github:/, "https://github.com/");
};

const npm = [];
const paths = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { cwd: root, encoding: "utf8" })
  .trim().split("\n").slice(1); // the first line is the app itself
for (const dir of new Set(paths)) {
  const p = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const license = typeof p.license === "string" ? p.license : p.license?.type ?? p.licenses?.map((l) => l.type).join(" OR ") ?? "see package";
  npm.push({ name: p.name, version: p.version, license, url: p.homepage ?? repo(p.repository), source: "npm" });
}

const cargo = process.env.CARGO ?? join(homedir(), ".cargo/bin/cargo");
const meta = JSON.parse(execFileSync(cargo, ["metadata", "--format-version", "1", "--filter-platform", "aarch64-apple-darwin"],
  { cwd: join(root, "src-tauri"), encoding: "utf8", maxBuffer: 64 << 20 }));
// Crates reached from the app through normal (not build or dev) dependencies.
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const seen = new Set();
const walk = (id) => {
  for (const d of nodes.get(id)?.deps ?? []) {
    if (!d.dep_kinds.some((k) => k.kind === null) || seen.has(d.pkg)) continue;
    seen.add(d.pkg);
    walk(d.pkg);
  }
};
walk(meta.resolve.root);
const crates = meta.packages.filter((p) => seen.has(p.id) && p.source)
  .map((p) => ({ name: p.name, version: p.version, license: p.license ?? "see crate", url: p.repository ?? `https://crates.io/crates/${p.name}`, source: "crate" }));

const all = [...npm, ...crates].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
writeFileSync(join(root, "src/licenses.json"), JSON.stringify(all, null, 1) + "\n");
console.log(`${npm.length} npm packages, ${crates.length} crates → src/licenses.json`);
