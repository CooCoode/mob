// make release writes the version into the files that carry it, then commits them before tagging.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
