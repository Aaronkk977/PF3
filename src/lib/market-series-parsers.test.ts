import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combineMarginMarket,
  maintenanceRatioPercent,
  parseTpexCloses,
  parseTpexMargin,
  parseTwseCloses,
  parseTwseMarginAll,
  parseVixDailyFile,
  parseVixIndexHistory,
  parseVixMonthlyFile,
} from "@/lib/market-series-parsers";

test("VIX 月檔取最後一欄（收盤前 1 分鐘平均）", () => {
  const text = [
    "交易日期\t時間\t臺指選擇權波動率指數\t收盤前1分鐘平均指數",
    "--------\t----\t----\t----",
    "20261021\t13450000\t\t\t28.40\t\t28.37",
    "20261022\t13450000\t\t\t30.31\t\t30.35\r",
  ].join("\n");
  assert.deepEqual(
    [...parseVixMonthlyFile(text)],
    [
      ["20261021", 28.37],
      ["20261022", 30.35],
    ],
  );
});

test("VIX 單日檔取 Last 1 min AVG", () => {
  const text = [
    "header",
    "20261022\t9000000\t\t\t29.28",
    "20261022\t13450000\t\t\t30.31",
    "20261022\tLast 1 min AVG\t\t\t30.35",
  ].join("\n");
  assert.equal(parseVixDailyFile(text), 30.35);
});

test("VIX 單日檔整天同一個值視為資料凍結", () => {
  const rows = Array.from({ length: 20 }, (_, i) => `20260730\t${11000000 + i * 1500}\t\t\t24.84`);
  rows.push("20260730\tLast 1 min AVG\t\t\t24.84");
  assert.equal(parseVixDailyFile(rows.join("\n")), null);
});

test("VIX 指數專區歷史：d 是 JSON 字串，略過壞列", () => {
  const d = JSON.stringify({
    TrendData: [
      { Time: "20231031", Price: 17.07 },
      { Time: "2023/11/01", Price: 16.62 },
      { Time: "20231102", Price: 0 },
      { Time: "20231103", Price: 15.15 },
    ],
  });
  assert.deepEqual(
    [...parseVixIndexHistory({ d })],
    [
      ["20231031", 17.07],
      ["20231103", 15.15],
    ],
  );
  assert.equal(parseVixIndexHistory({ d: "not json" }).size, 0);
  assert.equal(parseVixIndexHistory({}).size, 0);
});

test("證交所融資：融資金額（仟元）與各股餘額（張）", () => {
  const parsed = parseTwseMarginAll({
    stat: "OK",
    tables: [
      {
        title: "115年10月16日 信用交易統計",
        data: [
          ["融資(交易單位)", "1", "1", "0", "9,521,230", "9,538,664"],
          ["融資金額(仟元)", "1", "1", "0", "646,415,871", "645,594,048"],
        ],
      },
      {
        title: "115年10月16日 融資融券彙總 (全部)",
        data: [
          ["2330", "台積電", "0", "0", "0", "100", "120", "0"],
          ["0050", "元大台灣50", "0", "0", "0", "5", "0", "0"],
        ],
      },
    ],
  });
  assert.equal(parsed?.loanAmount, 645_594_048_000);
  assert.deepEqual([...parsed!.balances], [["2330", 120_000]]);
  assert.equal(parseTwseMarginAll({ stat: "很抱歉，沒有符合條件的資料" }), null);
});

test("證交所收盤價：無成交（--）的個股略過", () => {
  const closes = parseTwseCloses({
    stat: "OK",
    tables: [
      {
        title: "每日收盤行情(全部(不含權證、牛熊證、可展延牛熊證))",
        fields: ["證券代號", "證券名稱", "成交股數", "成交筆數", "成交金額", "開盤價", "最高價", "最低價", "收盤價"],
        data: [
          ["2330", "台積電", "", "", "", "", "", "", "1,050.00"],
          ["9999", "停牌", "", "", "", "", "", "", "--"],
        ],
      },
    ],
  });
  assert.deepEqual([...closes!], [["2330", 1050]]);
});

test("櫃買中心融資與收盤價", () => {
  const margin = parseTpexMargin({
    tables: [
      {
        fields: ["代號", "名稱", "前資餘額(張)", "資買", "資賣", "現償", "資餘額"],
        data: [["6488", "環球晶", "0", "0", "0", "0", "2,000"]],
        summary: [
          ["", "合計(張)", "1", "1", "1", "1", "2,364,632"],
          ["", "融資金(仟元)", "1", "1", "1", "1", "218,250,119"],
        ],
      },
    ],
  });
  assert.equal(margin?.loanAmount, 218_250_119_000);
  assert.equal(parseTpexMargin({ tables: [{ fields: [], data: [] }] }), null);

  const closes = parseTpexCloses({
    tables: [{ fields: ["代號", "名稱", "收盤 "], data: [["6488", "環球晶", "400.00"]] }],
  });
  const day = combineMarginMarket(margin!, closes!);
  assert.equal(day.collateralValue, 2_000_000 * 400);
});

test("維持率＝總市值 ÷ 總融資金額", () => {
  assert.equal(
    maintenanceRatioPercent([
      { loanAmount: 100, collateralValue: 160 },
      { loanAmount: 100, collateralValue: 180 },
    ]),
    170,
  );
  assert.equal(maintenanceRatioPercent([]), null);
});
