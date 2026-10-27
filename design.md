# 美術語言（Design Language）

這份文件整理 Portfolio Performance 目前的視覺風格與 UI 慣例，新增或改版畫面時以此為準。
「現況」是程式裡已經這樣做的；「建議」是之後新畫面應該採用、但舊畫面還沒全部跟上的。

樣式來源：`src/app/globals.css`（主題變數與全站 class）、`src/components/ui/`（共用元件）。
不引入其他 UI 函式庫，一律用 Tailwind ＋ CSS 變數。

---

## 1. 定位與原則

一個人自己用的投資儀表板，風格是**深色、資料密集的終端機／交易看盤介面**。

- **資料優先**：畫面主角是數字和表格，裝飾越少越好。顏色只用在「漲跌」與「主色重點」。
- **安靜的層次**：用細外框、細分隔線、字色深淺分層，不用大色塊、厚陰影或滿版漸層。
- **主題可換**：所有顏色都透過 CSS 變數，任何元件在三套主題下都要能看。
- **緊湊**：字級以 `text-xs`／`text-sm` 為主，一個畫面盡量多呈現資訊，但列與列之間仍要留呼吸空間。

---

## 2. 主題與色彩

主題由 `<html data-theme="…">` 切換，顏色一律用 `var(--color-*)`，**不要在元件裡寫死色碼**。

| 變數 | Cyberpunk（預設） | Noir（黑底淺字） | Monochrome（米色底） | 用途 |
|---|---|---|---|---|
| `--color-background` | `#0a0e17` | `#0a0a0a` | `#f3ede4` | 頁面底色、輸入框底色、浮層底色 |
| `--color-card` | `#111827` | `#141414` | `#faf6ef` | 卡片底色 |
| `--color-card-border` | `#1e3a5f` | `#404040` | `#d4cdc2` | 外框、分隔線、次要底色 |
| `--color-foreground` | `#e8f4ff` | `#f5f5f5` | `#1c1917` | 主要文字 |
| `--color-muted` | `#6b8aab` | `#a3a3a3` | `#6b6560` | 次要文字、說明、未啟用狀態 |
| `--color-primary` | `#00f0ff` 霓虹青 | `#f5f5f5` 白 | `#1c1917` 深棕黑 | 標題、選取狀態、主要按鈕、連結 |
| `--color-accent` | `#ff00aa` 洋紅 | `#a3a3a3` | `#57534e` | 第二強調色（少用） |
| `--grid-opacity` | `0.03` | `0.08` | `0.05` | 背景格線濃度 |
| `--glow-strength` | `1` | `0` | `0` | 發光效果倍率 |

要點：

- **Noir 和 Monochrome 是純灰階**，primary 就是前景色。所以「選取狀態」不能只靠主色區分，要搭配外框或底色深淺。
- 半透明一律用 `color-mix(in srgb, var(--color-x) N%, transparent)`，或 Tailwind 的 `bg-[var(--color-x)]/15`。常用比例：
  - 底色 **3～8%**（hover、展開區、選取）
  - 底色 **12～15%**（按鈕、標亮）
  - 外框 **25～60%**

### 漲跌色

由 `<html data-color-mode="green-up | red-up">` 切換，用 `var(--color-positive)`／`var(--color-negative)`，或 `.positive`／`.negative` class。

| | Cyberpunk | Noir／Monochrome |
|---|---|---|
| 綠漲紅跌（預設） | 漲 `#00ff88`、跌 `#ff4466` | 漲 `#15803d`、跌 `#b91c1c` |
| 紅漲綠跌（台股） | 兩色對調 | 兩色對調 |

- **漲跌色同時也是「買／賣」與「危險操作」的顏色**：`.trade-buy` 用漲色，`.trade-sell` 用跌色，刪除按鈕用 `--color-negative`。
- 注意：在紅漲綠跌模式下，`--color-negative` 會變成綠色，所以刪除按鈕也會跟著變綠（現況，見第 10 節）。

---

## 3. 字體與字級

| 用途 | 字體 | 設定 |
|---|---|---|
| 內文、中文 | Noto Sans TC（思源黑體），備援微軟正黑體 | `var(--font-sans)`，全站預設 |
| 代號、數字欄、頁面大標 | Cascadia Code／JetBrains Mono ＋ 正黑體中文 | `font-mono` |
| 時鐘 | Exo 2 | `.clock-display` |

- **禁止回退新細明體**：mono 字體堆疊不寫 `monospace`，中文會落到正黑體。
- 數字一律加 `tabular-nums`（等寬數字，欄位才對得齊）。
- 字級分布（現況統計）：`text-xs` 最多，其次 `text-sm`。細小標籤用 `text-[10px]`／`text-[11px]`。`text-2xl` 只用在頁面大標。

| 層級 | 樣式 |
|---|---|
| 頁面大標（Holdings、Overview…） | `font-mono text-2xl font-bold text-[var(--color-primary)] glow-text` |
| 卡片標題（`CardTitle`） | `text-sm font-semibold uppercase tracking-widest text-[var(--color-primary)]` |
| 區塊內小標 | `text-sm font-semibold`（前景色） |
| 表頭 | `text-xs uppercase tracking-wider text-[var(--color-muted)]`，排序中的欄位改用主色 |
| 內文 | `text-sm` |
| 說明文字 | `text-xs text-[var(--color-muted)]` |
| 側邊目錄標題、極小標籤 | `text-[10px] uppercase tracking-wider text-[var(--color-muted)]` |

---

## 4. 版面與間距

- 主內容寬度 `max-w-7xl`，左右 `px-6`，上下 `py-8`（`app-shell.tsx`）。
- 頁面由多個 `PageSection` 組成，區塊之間 `mt-8`。在 `xl` 以上，左側會出現區塊目錄（sticky，`w-40`，左邊一條細線）。
- 卡片內距 `p-6`，標題與內容之間 `pb-2`／`pt-2`。
- 頂部導覽列 sticky，底色 `background/95` 加背景模糊。目前所在頁面用一個會滑動的膠囊標示（主色 15% 底、30% 外框）。
- 圓角：一般元件 `rounded-md`（按鈕、輸入框、選單），卡片和面板 `rounded-lg`，徽章和圓點 `rounded-full`。不使用更大的圓角。

---

## 5. 表面層級

由下到上：

1. **頁面背景**：`--color-background`，上面疊 40px 的淡格線（`body::before`，Cyberpunk 用青色格線，其他主題用灰色）。
2. **卡片**（`Card`）：`--color-card` 95% 不透明、背景模糊、`glow-border`（主色 25% 外框，加上依主題倍率縮放的外發光）。
3. **卡片內的群組／展開區**：`border-[var(--color-card-border)]`，底色 `color-mix(foreground 3%)`，`rounded-lg`。
4. **浮層**（下拉選單、搜尋建議、Modal、抽屜）：`--color-background` 底、`--color-card-border` 外框、`shadow-lg`／`shadow-xl`。Modal 的遮罩是 `bg-black/60`。

列表分隔：用 `border-b border-[var(--color-card-border)]/40`（表格列、清單列）或 `divide-y`。不在每一列加外框。

---

## 6. 共用元件

| 元件 | 檔案 | 重點 |
|---|---|---|
| `Card`／`CardHeader`／`CardTitle`／`CardContent` | `ui/card.tsx` | 所有區塊的外殼 |
| `CollapsibleCard` | `ui/collapsible-card.tsx` | 可收合的卡片，箭頭旋轉 300ms；`variant="settings"` 會在左邊加 3px 主色邊 |
| `Button` | `ui/button.tsx` | 見下表 |
| `Input`／`Select` | `ui/input.tsx`、`ui/select.tsx` | `h-10`（緊湊處用 `h-8 text-xs`），背景色同頁面底色，focus 時主色 50% 光圈 |
| `Badge` | `ui/badge.tsx` | 主色 10% 底、30% 外框的膠囊 |
| `DropdownMenu` | `ui/dropdown-menu.tsx` | 「⋮」更多選單 |
| `Modal` | `ui/modal.tsx` | 置中對話框，點背景或按 Esc 關閉 |
| `Drawer` | `ui/drawer.tsx` | 右側滑入、可拖曳調整寬度（筆記用） |
| `SymbolSearchInput` | `portfolio/symbol-search-input.tsx` | 代號搜尋加下拉建議，加入標的一律用它 |

### 按鈕

| variant | 外觀 | 用途 |
|---|---|---|
| `default` | 主色 15% 底、40% 外框、主色字 | 主要動作（建立、儲存、套用） |
| `outline` | 透明底、灰外框，hover 時轉主色 | 次要動作 |
| `ghost` | 無底無框，hover 時加前景色 6% 底 | 取消、工具列上的動作 |
| `accent` | accent 色版本的 default | 少用 |
| 危險 | 在 default 上覆寫成 `--color-negative` 的 15% 底、40% 外框 | 確定刪除 |

- **不使用實心色塊按鈕**，所有按鈕都是「淡底＋同色外框＋同色字」。
- 尺寸：卡片內大多用 `size="sm"`（`h-8 text-xs`）。
- 只有圖示的按鈕：`rounded-md p-1.5 text-[var(--color-muted)]`，hover 時加淡底並換成前景色；危險按鈕 hover 時換成跌色。一定要加 `aria-label` 和 `title`。
- 圖示一律用 `lucide-react`，大小 `h-3.5 w-3.5`～`h-4 w-4`，裝飾用的圖示要加 `aria-hidden`。

---

## 7. 互動模式

### 7.1 顯示更多內容：優先「原地展開」

現況：投資帳戶設定、績效／交易頁的設定區、類別面板，都是點一下就在原地展開。

- **一次只展開一個**（用 `expandedId` 記錄），再點一次就收合。
- 用 `ChevronDown` 搭配 `rotate-180` 和 `transition-transform duration-300` 表示狀態，並加上 `aria-expanded`。
- 在格狀排列中展開時，展開區**插在被點卡片那一列的後面、橫跨整列**，不要讓卡片自己撐高而打亂格子（參考 `holdings-categories-panel.tsx` 的 `useGridColumnCount`）。
- 選取中的卡片：主色 60% 外框、主色 8% 底。

### 7.2 什麼時候才用 Modal／抽屜

- **Modal**：只用在必須打斷流程的情況，例如需要使用者明確回答才能繼續。一般的新增和編輯不用 Modal。
- **抽屜**：內容很長、需要邊看主畫面邊編輯的情況（目前只有筆記）。
- 新增項目：用一張虛線外框的「＋ 新增…」卡片或列，點了在原地展開成表單。

### 7.3 編輯

- 名稱類欄位：點「改名」後在原地變成輸入框。Enter 儲存、Esc 取消，旁邊放「儲存／取消」。
- 表格資料：在表格內直接編輯（交易頁現況）。

### 7.4 刪除與危險操作

- **建議**：在原地做兩段式確認。按「刪除」後，同一個位置換成一句影響說明（例如「4 檔會解除此分類，交易紀錄不受影響」）加上危險樣式的「確定刪除」和「取消」。類別面板已經這樣做。
- **現況**：其他 9 處用 `window.confirm()`（筆記、追蹤清單、快速新增交易…），之後改版時可以逐步換成原地確認。
- 移除清單裡的單一項目（例如類別裡的一檔標的）是小動作、可以馬上加回來，不需要確認，但 `×` 只在滑過該列時才清楚顯示（`opacity-0 group-hover:opacity-100 focus-visible:opacity-100`），避免誤按。

### 7.5 搜尋與篩選

- 小型搜尋框：`h-8 text-xs`，左側放 `Search` 圖示，按 Esc 清空。
- 篩選結果中符合的項目用主色 12% 底標亮。
- 沒有結果時顯示一句灰字說明，例如「沒有符合「xxx」的…」。

### 7.6 狀態的呈現

- 「未持有／停用／次要」：整行改用 `--color-muted` 字色，不加額外圖示或外框。
- 錯誤訊息：`text-xs text-[var(--color-negative)]`，放在區塊頂端或表單下方。
- 載入中：首次載入用骨架畫面（`animate-pulse`）或「載入中…」灰字。重新整理資料時**不要**把整塊切回載入狀態，保留舊內容直到新資料到達，避免畫面閃爍。

---

## 8. 圖表（Recharts）

- 顏色由 `src/lib/chart-palette.ts`／`chart-theme.ts` 依主題提供，元件不寫死顏色。
- Cyberpunk：帳戶線用青色系，比較基準（benchmark）用洋紅／橘色系（`BENCHMARK_COLORS`），兩組一冷一暖分開。
- Noir／Monochrome：帳戶線與比較基準都改用灰階色組。
- 格線和座標軸用 `--color-card-border`／`--color-muted`；圖表內文字強制使用 `--font-sans`。

---

## 9. 特效

特效要節制，並且都要跟著主題開關。

- **發光**：`.glow-border`、`.glow-text` 的強度乘上 `--glow-strength`，所以只有 Cyberpunk 會發光。新特效也要遵守這個規則。
- **背景格線**：`body::before`，濃度由 `--grid-opacity` 控制。
- **台股漲停**：`.tw-limit-up`，外圈漲色光暈加旋轉的錐形漸層。這是全站唯一的持續動畫，只用在漲停這個特殊狀態，不要挪用到別處。
- **轉場**：顏色變化用 `transition-colors`，展開箭頭和導覽膠囊用 300ms `ease-out`／`ease-in-out`。不做彈跳或大位移的動畫。

---

## 10. 文字與文案

- 介面一律使用**繁體中文**。專有名詞（ETF、P&L、代號）可以保留英文。
- 卡片標題用中文（交易記錄、追蹤清單、類別…），套用 `CardTitle` 樣式。英文全大寫只用在頂部導覽列（OVERVIEW、HOLDINGS…）和頁面大標。
- 台股代號在空間有限的地方可以省略 `.TW`／`.TWO` 後綴，連結和資料仍然使用完整代號。
- 數字：金額用 `formatCurrency`，百分比用 `formatPercent`，並一律 `tabular-nums`。

---

## 11. 已知問題／待改進

- **Noir 的跌色 `#b91c1c` 在黑底上偏暗**，危險按鈕和下跌數字的對比不足。可以考慮在 Noir 改用比較亮的紅（例如 `#ef4444`），綠色同理。
- **紅漲綠跌模式下，危險按鈕會變成綠色**，因為兩者共用 `--color-negative`。建議另外定義 `--color-danger`，不隨漲跌配色切換。
- `window.confirm()` 還有 9 處，與「原地兩段式確認」的建議不一致。
- 持倉頁的骨架畫面（`HoldingsClient` 的 `animate-pulse`）在載入時會出現 hydration mismatch。

---

## 12. 新畫面檢查清單

- [ ] 顏色只用 `var(--color-*)`，沒有寫死色碼。
- [ ] 在 Cyberpunk、Noir、Monochrome 三套主題下都看過；灰階主題下選取狀態仍然分辨得出來。
- [ ] 漲跌、買賣用 `--color-positive`／`--color-negative`，並在兩種漲跌配色下都看過。
- [ ] 數字和代號用 `font-mono`／`tabular-nums`。
- [ ] 顯示更多內容用原地展開，沒有多開不必要的 Modal。
- [ ] 刪除有確認；只有圖示的按鈕有 `aria-label`／`title`。
- [ ] 重新整理資料時畫面不會閃回載入狀態。
- [ ] 使用共用元件（`Card`、`Button`、`Input`、`Select`、`SymbolSearchInput`），沒有自己另做一套。
