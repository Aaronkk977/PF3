/** service 層（src/lib/notes.ts、transactions.ts 等）用來回報「使用者輸入有誤／
 *  資料不存在」這類可預期的錯誤。API 路由用 serviceErrorResponse() 轉成對應的
 *  HTTP 狀態碼；MCP server 直接把 message 回給 Claude。其他例外照常往上丟。 */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
