// make release writes the version into the files that carry it, then commits them before tagging.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { version } from './release.mjs';

export const VERSION_FILES = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];

// npm and Tauri write 2-space JSON; anything else would be reformatted, so it is refused.
function json(file, text, set) {
  const data = JSON.parse(text);
  if (JSON.stringify(data, null, 2) + '\n' !== text) throw Error(`${file}: not 2-space JSON; reformat it first`);
  set(data);
  return JSON.stringify(data, null, 2) + '\n';
}

function once(file, text, pattern, version) {
  const all = new RegExp(pattern.source, `${pattern.flags}g`);
  if ((text.match(all) ?? []).length !== 1) throw Error(`${file}: expected one version entry`);
  return text.replace(pattern, (_, before, after) => `${before}${version}${after}`);
}

const edits = {
  'package.json': (f, t, v) => json(f, t, d => { d.version = v; }),
  'package-lock.json': (f, t, v) => json(f, t, d => { d.version = v; d.packages[''].version = v; }),
  'src-tauri/tauri.conf.json': (f, t, v) => json(f, t, d => { d.version = v; }),
  // The [package] version, not a dependency's.
  'src-tauri/Cargo.toml': (f, t, v) => once(f, t, /^(\[package\]\n(?:(?!\[).*\n)*?version = ")[^"]*(")/m, v),
  'src-tauri/Cargo.lock': (f, t, v) => once(f, t, /^(name = "mob"\nversion = ")[^"]*(")/m, v),
};

const reads = {
  'package.json': t => [JSON.parse(t).version],
  'package-lock.json': t => { const d = JSON.parse(t); return [d.version, d.packages?.['']?.version]; },
  'src-tauri/tauri.conf.json': t => [JSON.parse(t).version],
  'src-tauri/Cargo.toml': t => [...t.matchAll(/^\[package\]\n(?:(?!\[).*\n)*?version = "([^"]*)"/gm)].map(m => m[1]),
  'src-tauri/Cargo.lock': t => [...t.matchAll(/^name = "mob"\nversion = "([^"]*)"/gm)].map(m => m[1]),
};

// The version all version files agree on. read(file) returns a file's text; by default from root.
export function readVersion(root, read = file => readFileSync(join(root, file), 'utf8')) {
  const found = VERSION_FILES.map(file => [file, reads[file](read(file))]);
  for (const [file, versions] of found) {
    if (versions.length !== (file === 'package-lock.json' ? 2 : 1)) throw Error(`${file}: expected one version entry`);
  }
  const all = new Set(found.flatMap(([, versions]) => versions));
  if (all.size !== 1) throw Error(`The version files disagree: ${found.map(([f, v]) => `${f} ${v.join('/')}`).join(', ')}`);
  return version([...all][0]);
}

// Updates the version files under root; returns the ones that changed. Nothing is written unless
// every file has the expected shape.
export function bumpVersion(root, version) {
  const updates = VERSION_FILES.map(file => {
    const before = readFileSync(join(root, file), 'utf8');
    return [file, before, edits[file](file, before, version)];
  });
  const changed = updates.filter(([, before, after]) => after !== before);
  for (const [file, , after] of changed) writeFileSync(join(root, file), after);
  return changed.map(([file]) => file);
}

export const PARTS = ['major', 'minor', 'patch'];

// The next version after current for make release-major, -minor or -patch.
export function increment(current, part) {
  const i = PARTS.indexOf(part);
  if (i < 0) throw Error(`Expected one of ${PARTS.join(', ')}`);
  const n = version(current).split('.').map(Number);
  n[i]++;
  n.fill(0, i + 1);
  return n.join('.');
}

export function compareVersions(a, b) {
  const x = version(a).split('.').map(BigInt), y = version(b).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
