import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync,
} from "fs";
import { join } from "path";
import os from "os";

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

// next.config 的 outputFileTracingIncludes 把整個 Prisma 資料夾帶進來（excludes
// 管不到 include 進來的檔案），裡面有 app 用不到的大檔：其他平台的原生引擎、
// generate 失敗留下的 .tmp 引擎、其他資料庫的 wasm runtime。app 只在 Windows
// 用 SQLite + 原生引擎，這些刪掉可以少複製、少壓縮幾十到幾百 MB。
function pruneDir(dir, pattern) {
  if (!existsSync(dir)) return 0;
  let bytes = 0;
  for (const f of readdirSync(dir)) {
    if (!pattern.test(f)) continue;
    const p = join(dir, f);
    bytes += statSync(p).size;
    rmSync(p, { force: true });
  }
  return bytes;
}

const pruned =
  pruneDir(
    join(standaloneDir, "node_modules", ".prisma", "client"),
    /^libquery_engine-|\.dll\.node\.tmp\d+$/,
  ) +
  pruneDir(
    join(standaloneDir, "node_modules", "@prisma", "client", "runtime"),
    /\.(mysql|postgresql|sqlserver|cockroachdb)\.(js|mjs|wasm)$|\.(mysql|postgresql|sqlserver|cockroachdb)\.wasm-base64\.(js|mjs)$/,
  );
console.log(`Pruned ${(pruned / 1024 / 1024).toFixed(1)} MB of unused Prisma files.`);

console.log("Standalone bundle ready.");

// ── Electron 打包用副本 ──────────────────────────────────────────────────
// 1) electron-builder 的 extraResources 複製會整包跳過「頂層剛好叫
//    node_modules」的資料夾（已實測確認，巢狀的不受影響），因此另外準備一份
//    把 node_modules 改名成 _node_modules 的副本；打包完成後由
//    scripts/electron-after-pack.cjs 的 afterPack hook 把名字改回來。
// 2) 這份副本刻意放在系統暫存目錄（而非專案目錄底下）：實測發現放在專案目錄
//    內時，複製完成後 `.next`／`.env` 子路徑會在短時間內被本機環境中某個
//    非本專案的東西悄悄清掉（尚未查出確切來源），os.tmpdir() 不受影響。
const electronResourcesDir = join(os.tmpdir(), "pf-electron-standalone");
rmSync(electronResourcesDir, { recursive: true, force: true });
mkdirSync(electronResourcesDir, { recursive: true });
cpSync(standaloneDir, electronResourcesDir, { recursive: true });
renameSync(
  join(electronResourcesDir, "node_modules"),
  join(electronResourcesDir, "_node_modules"),
);
console.log(`Electron resource bundle ready -> ${electronResourcesDir}`);
