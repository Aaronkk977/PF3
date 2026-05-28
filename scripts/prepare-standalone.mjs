import { cpSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const root = process.cwd();
const standaloneDir = join(root, ".next", "standalone");
const serverJs = join(standaloneDir, "server.js");

if (!existsSync(serverJs)) {
  console.error(
    "Missing .next/standalone/server.js — run `npm run build` first.",
  );
  process.exit(1);
}

function copyDir(src, dest, label) {
  if (!existsSync(src)) {
    console.warn(`Skip ${label}: not found at ${src}`);
    return;
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${label} -> ${dest}`);
}

copyDir(join(root, ".next", "static"), join(standaloneDir, ".next", "static"), "static");
copyDir(join(root, "public"), join(standaloneDir, "public"), "public");

console.log("Standalone bundle ready.");
