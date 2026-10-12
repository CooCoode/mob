/**
 * svnc is not on the public npm registry yet.
 * GitHub install omits tsconfig (package.json "files"), so we write one and build dist/.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svncRoot = join(root, "node_modules", "svnc");
const distEntry = join(svncRoot, "dist", "index.js");
const tsconfigPath = join(svncRoot, "tsconfig.json");

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    lib: ["ES2022", "DOM"],
    strict: true,
    skipLibCheck: true,
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    outDir: "dist",
    rootDir: "src",
    noUnusedLocals: true,
    noUnusedParameters: true,
    exactOptionalPropertyTypes: false,
  },
  include: ["src/**/*.ts"],
};

if (!existsSync(svncRoot)) {
  console.warn("[build-svnc] node_modules/svnc missing; skip");
  process.exit(0);
}

if (existsSync(distEntry)) {
  process.exit(0);
}

console.log("[build-svnc] building github:xrdavies/svnc …");

if (!existsSync(join(svncRoot, "node_modules", "typescript"))) {
  const npmInstall = spawnSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: svncRoot, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (npmInstall.status !== 0) {
    console.error("[build-svnc] npm install in svnc failed");
    process.exit(npmInstall.status ?? 1);
  }
}

if (!existsSync(tsconfigPath)) {
  writeFileSync(tsconfigPath, `${JSON.stringify(TSCONFIG, null, 2)}\n`);
  console.log("[build-svnc] wrote missing tsconfig.json");
}

const tscBin = join(svncRoot, "node_modules", "typescript", "bin", "tsc");
const tsc = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json"], {
  cwd: svncRoot,
  stdio: "inherit",
});
if (tsc.status !== 0 || !existsSync(distEntry)) {
  console.error(
    "[build-svnc] tsc failed — UI will show a stub until dist exists",
  );
  process.exit(0);
}

console.log("[build-svnc] ok →", distEntry);
