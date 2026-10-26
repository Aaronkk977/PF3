const { app, BrowserWindow, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");
const { fork } = require("child_process");
const { runMigrations } = require("./migrate");

const HOSTNAME = "127.0.0.1";
// 涵蓋「等 server process 活著」+「等開機維護（股票分割偵測＋幣別／
// 追蹤清單名稱校正）跑完」兩段，維護第一次跑（或冷卻到期後）可能要等
// 外部 API，時間拉長一點比較保險。
const HEALTH_TIMEOUT_MS = 120_000;

// 打包後 Windows 的工作列／視窗圖示是吃 exe 本身內嵌的那份（由
// electron-builder 從 assets/icon.png 轉出來），這裡指定的是給開發模式用的，
// 不然 npm run electron 會顯示 Electron 預設的原子圖示。
const APP_ICON = path.join(__dirname, "icon.png");

let serverProcess = null;
let mainWindow = null;
let splashWindow = null;
let baseUrl = "";
let serverLogs = "";

// 對齊既有 launcher/start.ps1 使用的 %APPDATA%\PortfolioPerformance，
// 不依賴 Electron 預設 userData 命名，確保沿用舊版使用者的既有資料。
// PF_APPDATA_OVERRIDE：僅供手動測試「全新安裝」情境使用，一般執行不會設定此變數。
function getUserDataDir() {
  const base = process.env.PF_APPDATA_OVERRIDE || app.getPath("appData");
  return path.join(base, "PortfolioPerformance");
}

function getResourcesRoot() {
  // 開發模式（electron .）：資源就在專案根目錄；打包後：resourcesPath 下。
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..");
}

// 前端設定（主題、漲跌配色等）存在 localStorage，而 localStorage 是依
// origin（含埠號）分開存的；每次開啟都換隨機埠就等於每次都是新的儲存區，
// 設定會「跑掉」。所以優先固定用這個埠，被佔用時才退回隨機埠。
const PREFERRED_PORT = 38517;

async function pickFreePort() {
  try {
    return await probePort(PREFERRED_PORT);
  } catch {
    return probePort(0);
  }
}

function probePort(requestedPort) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(requestedPort, HOSTNAME, () => {
      const addr = probe.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      probe.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (!port) {
          reject(new Error("無法配置本機埠"));
          return;
        }
        resolve(port);
      });
    });
  });
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      serverProcess?.off("exit", onExit);
      if (err) reject(err);
      else resolve();
    };

    const onExit = (code) => {
      const tail = serverLogs.trim().slice(-800);
      finish(
        new Error(
          `本機伺服器無法啟動（code ${code}）${tail ? `\n${tail}` : ""}`,
        ),
      );
    };

    serverProcess?.once("exit", onExit);

    function attempt() {
      if (settled) return;
      const req = http.get(url, (res) => {
        res.resume();
        finish();
      });
      req.on("error", () => {
        if (settled) return;
        if (Date.now() > deadline) {
          finish(
            new Error(`Server did not respond within ${timeoutMs}ms at ${url}`),
          );
          return;
        }
        setTimeout(attempt, 400);
      });
    }
    attempt();
  });
}

/** 對現有 SQLite DB 套用尚未套用的 migration（不動已套用過的，安全） */
function applyPendingMigrations(dbFilePath) {
  const migrationsDir = path.join(getResourcesRoot(), "prisma", "migrations");
  try {
    return runMigrations(dbFilePath, migrationsDir);
  } catch (err) {
    throw new Error(
      `資料庫更新失敗：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function startNextServer(env) {
  const resourcesRoot = getResourcesRoot();
  const serverJs = app.isPackaged
    ? path.join(resourcesRoot, "standalone", "server.js")
    : path.join(resourcesRoot, ".next", "standalone", "server.js");
  if (!fs.existsSync(serverJs)) {
    throw new Error(`找不到伺服器檔案：${serverJs}`);
  }

  serverProcess = fork(serverJs, [], {
    cwd: path.dirname(serverJs),
    env,
    stdio: "pipe",
  });

  const capture = (d) => {
    const text = String(d);
    serverLogs = (serverLogs + text).slice(-4000);
    process.stdout.write(`[server] ${text}`);
  };
  serverProcess.stdout?.on("data", capture);
  serverProcess.stderr?.on("data", capture);
  serverProcess.on("exit", (code) => {
    if (code !== 0 && mainWindow) {
      dialog.showErrorBox("伺服器已停止", `本機伺服器意外結束（code ${code}）`);
    }
  });
}

/** 開機一開始就先顯示的等待畫面：伺服器行程／開機維護（股票分割偵測＋
 *  幣別／追蹤清單名稱校正）跑完前，這是使用者唯一看得到的畫面，取代原本
 *  「什麼都不顯示、看起來像沒反應」的空窗期。純網頁、不掛 preload，只用
 *  fetch 輪詢 /api/startup/status，跟主視窗完全獨立。 */
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    icon: APP_ICON,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#00000000",
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"), {
    search: `base=${encodeURIComponent(baseUrl)}`,
  });
  splashWindow.once("ready-to-show", () => splashWindow?.show());
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    closeSplashWindow();
    mainWindow.maximize();
    mainWindow.show();
  });

  // 沒設自訂選單時，Electron 預設選單的「放大」快捷鍵是 CmdOrCtrl+Plus，
  // Windows 鍵盤上這個鍵位實際要按 Shift+= 才打得出「+」，所以裸的
  // Ctrl+= 不會命中；「縮小」預設是 CmdOrCtrl+-，不需要 Shift，才會正常。
  // 直接自己接管這三個鍵，同時涵蓋主鍵區與數字鍵區的 +/-。
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || (!input.control && !input.meta)) return;
    if (input.key === "=" || input.key === "+") {
      mainWindow.webContents.zoomLevel += 0.5;
      event.preventDefault();
    } else if (input.key === "-") {
      mainWindow.webContents.zoomLevel -= 0.5;
      event.preventDefault();
    } else if (input.key === "0") {
      mainWindow.webContents.zoomLevel = 0;
      event.preventDefault();
    }
  });

  mainWindow.loadURL(baseUrl);

  // 外部連結一律用系統瀏覽器開啟，視窗內只顯示本機 App
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(baseUrl)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  const userDataDir = getUserDataDir();
  const dataDir = path.join(userDataDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const dbFile = path.join(dataDir, "portfolio.db").replace(/\\/g, "/");
  const port = await pickFreePort();
  baseUrl = `http://${HOSTNAME}:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: "production",
    APP_RUNTIME: "desktop",
    APP_DATA_DIR: userDataDir,
    DATABASE_URL: `file:${dbFile}?socket_timeout=60`,
    PORT: String(port),
    HOSTNAME,
  };

  createSplashWindow();

  applyPendingMigrations(path.join(dataDir, "portfolio.db"));
  startNextServer(env);
  await waitForServer(baseUrl, HEALTH_TIMEOUT_MS);
  await waitForServer(`${baseUrl}/api/startup/status`, HEALTH_TIMEOUT_MS);
  createWindow();
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// 只允許一個實例：第二次開啟時，38517 已被第一個實例佔用，會退回隨機埠
// （localStorage 設定跟著不見），還會多起一個 server 同時寫同一個 SQLite。
// 所以第二個實例直接結束，改把既有視窗叫到前面。
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 還在啟動中就只有 splash，先顯示它
    const win = mainWindow ?? splashWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    await bootstrap();
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {
        // 離線或無新版時安靜失敗，不影響使用
      });
    }
  } catch (err) {
    closeSplashWindow();
    dialog.showErrorBox("啟動失敗", err instanceof Error ? err.message : String(err));
    app.quit();
  }
});

autoUpdater.on("update-downloaded", () => {
  dialog
    .showMessageBox({
      type: "info",
      title: "有新版本",
      message: "已下載新版本，是否立即重新啟動以套用更新？",
      buttons: ["立即重啟", "稍後"],
      defaultId: 0,
    })
    .then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
});

app.on("window-all-closed", () => {
  stopServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopServer);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverProcess) {
    createWindow();
  }
});
