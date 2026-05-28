import os from "os";
import path from "path";

const APP_FOLDER_NAME = "PortfolioPerformance";

/** Desktop launcher sets APP_RUNTIME=desktop */
export function isDesktopRuntime(): boolean {
  return process.env.APP_RUNTIME === "desktop";
}

/** User-writable data root (DB, imports, pid). */
export function getUserDataDir(): string {
  if (process.env.APP_DATA_DIR) {
    return process.env.APP_DATA_DIR;
  }
  if (!isDesktopRuntime() && process.env.NODE_ENV !== "production") {
    return path.join(process.cwd(), "data", "user");
  }
  const roaming =
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(roaming, APP_FOLDER_NAME);
}

export function getDatabaseFilePath(): string {
  return path.join(getUserDataDir(), "data", "portfolio.db");
}

export function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  const filePath = getDatabaseFilePath().replace(/\\/g, "/");
  return `file:${filePath}?socket_timeout=60`;
}

export function getImportDir(): string {
  return path.join(getUserDataDir(), "import");
}

export function getLegacyImportDir(): string {
  return path.join(getImportDir(), "legacy");
}
