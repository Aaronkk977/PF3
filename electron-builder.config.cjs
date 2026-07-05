/**
 * 獨立的 electron-builder 設定檔（而非寫死在 package.json 的 "build" 欄位），
 * 是因為 standalone 打包用的暫存資源資料夾一旦放在專案目錄底下，
 * 裡面的 `.next`／`.env` 子路徑會被本機環境中某個東西（非本專案程式碼、
 * 尚未查出確切來源，懷疑是編輯器或防毒軟體對 .gitignore 名稱的自動清理）
 * 在複製完成後的短時間內悄悄刪掉。改放到系統暫存目錄（os.tmpdir()）可穩定
 * 避開這個問題，而 package.json 的 "build" 欄位只能是靜態 JSON，
 * 無法動態組出這個路徑，所以改用這份 CommonJS 設定檔。
 */
const path = require("path");
const os = require("os");

const standaloneSource = path.join(os.tmpdir(), "pf-electron-standalone");

module.exports = {
  appId: "com.aaronkk977.portfolioperformance",
  productName: "Portfolio Performance",
  directories: {
    output: "release",
  },
  afterPack: "scripts/electron-after-pack.cjs",
  files: ["electron/main.js", "electron/preload.js", "package.json"],
  extraResources: [
    {
      from: standaloneSource,
      to: "standalone",
      filter: ["**/*"],
    },
    {
      from: "prisma/schema.prisma",
      to: "prisma/schema.prisma",
      filter: ["**/*"],
    },
    {
      from: "prisma/migrations",
      to: "prisma/migrations",
      filter: ["**/*"],
    },
    {
      from: "electron/prisma-cli-bundle/node_modules",
      to: "prisma-cli/node_modules",
      filter: ["**/*"],
    },
  ],
  asarUnpack: ["**/*.node", "**/*.dll.node", "**/@prisma/**", "**/.prisma/**"],
  win: {
    target: "nsis",
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
  },
  publish: {
    provider: "github",
    owner: "Aaronkk977",
    repo: "PF3",
  },
};
