import assert from "node:assert/strict";
import { test } from "node:test";
import { filterCategories } from "@/lib/category-filter";

const categories = [
  {
    id: "c1",
    name: "ABF",
    instruments: [
      { id: "i1", symbol: "3037.TW", name: "欣興" },
      { id: "i2", symbol: "8046.TW", name: "南電" },
    ],
  },
  {
    id: "c2",
    name: "光",
    instruments: [
      { id: "i3", symbol: "3081.TWO", name: "聯亞" },
      { id: "i1", symbol: "3037.TW", name: "欣興" },
    ],
  },
  { id: "c3", name: "Software", instruments: [] },
];

test("沒有搜尋字時全部保留，也不標記任何標的", () => {
  const r = filterCategories(categories, "  ");
  assert.equal(r.length, 3);
  assert.ok(r.every((x) => x.matchedInstrumentIds.size === 0));
});

test("類別名稱符合時整個保留（不分大小寫）", () => {
  const r = filterCategories(categories, "soft");
  assert.deepEqual(
    r.map((x) => x.category.id),
    ["c3"],
  );
  assert.equal(r[0].matchedInstrumentIds.size, 0);
});

test("從標的代號反查所屬的所有類別，並標出符合的標的", () => {
  const r = filterCategories(categories, "3037");
  assert.deepEqual(
    r.map((x) => x.category.id),
    ["c1", "c2"],
  );
  assert.deepEqual([...r[0].matchedInstrumentIds], ["i1"]);
  assert.deepEqual([...r[1].matchedInstrumentIds], ["i1"]);
});

test("也可以用標的名稱搜尋", () => {
  const r = filterCategories(categories, "聯亞");
  assert.deepEqual(
    r.map((x) => x.category.id),
    ["c2"],
  );
  assert.deepEqual([...r[0].matchedInstrumentIds], ["i3"]);
});
