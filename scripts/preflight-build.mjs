import { closeSync, existsSync, openSync, readFileSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

// Windows 不允許刪除／覆寫「已被某個 process 載入」的原生模組。只要 app 還開著，
// 它載入的 query_engine-windows.dll.node 就會讓 `prisma generate` 噴 EPERM，而
// `next build` 清 .next 時會卡在刪不掉的 .next/standalone 上（沒有錯誤、也不會逾時）。
// 這支腳本在 build 前先關掉 app，剩下的鎖則直接報錯，不要讓 build 空轉。

const root = process.cwd();
const pidFile = join(
  process.env.APPDATA ?? "",
  "PortfolioPerformance",
  "server.pid",
);

function stopRunningApp() {
  if (process.platform !== "win32" || !existsSync(pidFile)) return;
  const pid = readFileSync(pidFile, "utf8").trim();
  if (!/^\d+$/.test(pid)) return;
  try {
    execFileSync("taskkill", ["/PID", pid, "/F"], { stdio: "ignore" });
    console.log(`Stopped running app (pid ${pid}).`);
  } catch {
    // 已經不在了
  }
  rmSync(pidFile, { force: true });
}

// 開寫入用的 handle 就夠了：DLL 被載入時 Windows 不給寫（EBUSY），而 rename
// 反而是允許的，所以不能用改名來偵測。
function isLocked(dll) {
  if (!existsSync(dll)) return false;
  try {
    closeSync(openSync(dll, "r+"));
    return false;
  } catch {
    return true;
  }
}

const engines = [
  join(root, "node_modules", ".prisma", "client", "query_engine-windows.dll.node"),
  join(root, ".next", "standalone", "node_modules", ".prisma", "client", "query_engine-windows.dll.node"),
];

stopRunningApp();

// process 結束後 Windows 還要一下下才會拆掉檔案映射，所以先等鎖真的放掉。
let locked = engines.filter(isLocked);
for (let i = 0; i < 20 && locked.length > 0; i++) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  locked = locked.filter(isLocked);
}

if (locked.length > 0) {
  console.error("Build aborted: Prisma query engine is locked by a running process.");
  for (const dll of locked) console.error(`  ${dll}`);
  console.error(
    "Close the app and any `tsx scripts/mcp-server.ts` process (Claude Code's portfolio MCP server counts), then rebuild.",
  );
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | Format-List",
      ],
      { encoding: "utf8" },
    );
    console.error(`\nRunning node processes:\n${out}`);
  } catch {
    // 列不出來就算了，訊息本身已經夠指路
  }
  process.exit(1);
}
