import { closeSync, existsSync, openSync, readFileSync, rmSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

// Windows 不允許刪除／覆寫「已被某個 process 載入」的原生模組。只要 app 還開著，
// 它載入的 query_engine-windows.dll.node 就會讓 `prisma generate` 噴 EPERM，而
// `next build` 清 .next 時會卡在刪不掉的 .next/standalone 上（沒有錯誤、也不會逾時）。
// 這支腳本在 build 前先關掉會鎖住檔案的程式，剩下的鎖則直接報錯，不要讓 build 空轉。

const root = process.cwd();
const pidFile = join(
  process.env.APPDATA ?? "",
  "PortfolioPerformance",
  "server.pid",
);

/** 打包時要關掉的程式：
 *  - 桌面版 app：主程式、視窗、它 fork 出來的 Next server 都叫這個名字
 *    （安裝版跟 release\win-unpacked 都算）
 *  - `npm run electron:dev` 開的開發版
 *  - 從這個專案跑起來的 standalone server（launcher 或手動 node server.js）
 *  - Claude 的 portfolio MCP server（scripts/mcp-server.ts），它載入的就是
 *    node_modules 裡那顆 query engine */
const APP_EXE = "Portfolio Performance.exe";

function shouldStop(proc) {
  const cmd = (proc.CommandLine ?? "").replace(/\//g, "\\").toLowerCase();
  if (proc.Name === APP_EXE) return true;
  if (proc.Name === "electron.exe") return cmd.includes(root.toLowerCase());
  if (proc.Name !== "node.exe") return false;
  return (
    /scripts\\mcp-server\.ts/.test(cmd) ||
    /\.next\\standalone\\server\.js/.test(cmd)
  );
}

function listProcesses() {
  const out = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='electron.exe' or Name='Portfolio Performance.exe'\" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8" },
  ).trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function stopRunningApp() {
  if (process.platform !== "win32") return;

  // 舊版 PowerShell launcher 啟動的 server 會留下 pid 檔
  if (existsSync(pidFile)) {
    const pid = readFileSync(pidFile, "utf8").trim();
    if (/^\d+$/.test(pid)) {
      try {
        execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
      } catch {
        // 已經不在了
      }
    }
    rmSync(pidFile, { force: true });
  }

  let procs;
  try {
    procs = listProcesses().filter(
      (p) => p.ProcessId !== process.pid && shouldStop(p),
    );
  } catch (err) {
    console.warn(`Could not list running processes: ${err.message}`);
    return;
  }

  const stopped = [];
  for (const p of procs) {
    try {
      execFileSync("taskkill", ["/PID", String(p.ProcessId), "/T", "/F"], {
        stdio: "ignore",
      });
      stopped.push(p);
    } catch {
      // 可能已經跟著父行程一起被關掉了
    }
  }
  if (stopped.some((p) => p.Name === APP_EXE || p.Name === "electron.exe")) {
    console.log("Closed the running Portfolio Performance app.");
  }
  if (stopped.some((p) => /mcp-server/i.test(p.CommandLine ?? ""))) {
    console.log(
      "Stopped the portfolio MCP server (restart the Claude session to reconnect it).",
    );
  }
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
