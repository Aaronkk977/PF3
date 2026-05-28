# 安裝包（之後）

第一版使用 `launch.bat` + `launcher/start.ps1`，不需安裝程式。

之後可用 **Inno Setup** 或 **WiX**：

- 安裝路徑：`%ProgramFiles%\PortfolioPerformance\`
- 內容：`.next/standalone`、`node` runtime（或要求本機已安裝 Node）
- 捷徑指向 `launch.bat`
- 使用者資料仍放在 `%AppData%\PortfolioPerformance\`（與啟動器一致）

建置正式版：

```powershell
npm run build:app
```
