/**
 * Portfolio MCP Server 的進入點，工具本身在 scripts/mcp/portfolio-server.ts。
 *
 * Run:
 *   npx tsx scripts/mcp-server.ts
 *
 * Register in Claude Desktop (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "portfolio": {
 *         "command": "npx",
 *         "args": ["tsx", "C:/Users/User/Desktop/Porfolio Performance/scripts/mcp-server.ts"]
 *       }
 *     }
 *   }
 *
 * 這支只負責把環境準備好，讓 MCP 工具能直接重用 src/lib 的計算（跟網頁同一套）：
 *   1. stdout 是 MCP 的 JSON-RPC 通道，函式庫印到 console.log 的訊息（例如
 *      yahoo-finance2 的提示）會弄壞協定，所以全部改導到 stderr。
 *   2. src/lib 有些模組 import "server-only"，那是 Next.js 建置時才處理的特殊
 *      模組，這裡導到測試用的空檔案。
 *   3. yahoo-finance2 只提供 ESM 的 import 進入點，tsx 用 require 載入時找不到，
 *      直接指到它的 ESM 檔案（Node 22+ 可以 require ESM）。
 * 這些必須在載入任何 src/lib 模組之前設定好，所以工具程式放在另一個檔案，
 * 最後才 require 進來。
 */

import Module from "module";
import path from "path";
import { config } from "dotenv";

const root = path.resolve(__dirname, "..");
config({ path: path.join(root, ".env") });

console.log = console.error;
console.info = console.error;
console.debug = console.error;

const moduleInternals = Module as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string;
};
const resolveFilename = moduleInternals._resolveFilename;
const redirects: Record<string, string> = {
  "server-only": path.join(root, "src/lib/test-shims/server-only.ts"),
  "yahoo-finance2": path.join(root, "node_modules/yahoo-finance2/esm/src/index.js"),
};
moduleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return redirects[request] ?? resolveFilename.call(this, request, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("./mcp/portfolio-server");
