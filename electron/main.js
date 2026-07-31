const { app, BrowserWindow, dialog, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { fork } = require("child_process");
const { runMigrations } = require("./migrate");

const PORT = 3847;
const HOSTNAME = "127.0.0.1";
const BASE_URL = `http://${HOSTNAME}:${PORT}`;
// 涵蓋「等 server process 活著」+「等開機維護（股票分割偵測＋幣別／
// 追蹤清單名稱校正）跑完」兩段，維護第一次跑（或冷卻到期後）可能要等
// 外部 API，時間拉長一點比較保險。
const HEALTH_TIMEOUT_MS = 120_000;

let serverProcess = null;
let mainWindow = null;
let splashWindow = null;

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

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`Server did not respond within ${timeoutMs}ms at ${url}`));
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

  serverProcess.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));
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
    search: `base=${encodeURIComponent(BASE_URL)}`,
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

  mainWindow.loadURL(BASE_URL);

  // 外部連結一律用系統瀏覽器開啟，視窗內只顯示本機 App
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(BASE_URL)) {
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
  const env = {
    ...process.env,
    NODE_ENV: "production",
    APP_RUNTIME: "desktop",
    APP_DATA_DIR: userDataDir,
    DATABASE_URL: `file:${dbFile}?socket_timeout=60`,
    PORT: String(PORT),
    HOSTNAME,
  };

  createSplashWindow();

  applyPendingMigrations(path.join(dataDir, "portfolio.db"));
  startNextServer(env);
  await waitForServer(BASE_URL, HEALTH_TIMEOUT_MS);
  await waitForServer(`${BASE_URL}/api/startup/status`, HEALTH_TIMEOUT_MS);
  createWindow();
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
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
