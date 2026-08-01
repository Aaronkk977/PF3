import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  inferRequestPriority,
  resetActivePageForTests,
  withRequestScope,
} from "@/lib/request-priority";
import {
  BACKGROUND_SCOPE,
  PAGE_HEADER,
  SCOPE_HEADER,
} from "@/lib/page-request-headers";

function req(page?: string, background = false): Request {
  const headers = new Headers();
  if (page) headers.set(PAGE_HEADER, page);
  if (background) headers.set(SCOPE_HEADER, BACKGROUND_SCOPE);
  return new Request("http://localhost/api/test", { headers });
}

beforeEach(() => {
  resetActivePageForTests();
});

test("不在任何請求範圍內時視為高優先權", () => {
  assert.equal(inferRequestPriority(), "high");
});

test("使用者正在看的那一頁是高優先權", () => {
  withRequestScope(req("holdings"), () => {
    assert.equal(inferRequestPriority(), "high");
  });
});

test("背景預熱請求一律低優先權", () => {
  withRequestScope(req("holdings", true), () => {
    assert.equal(inferRequestPriority(), "low");
  });
});

test("切頁之後，切頁前就在飛的那個舊請求降成低優先權", async () => {
  // 持股頁的請求開始跑（還沒結束）
  await withRequestScope(req("holdings"), async () => {
    assert.equal(inferRequestPriority(), "high");

    // 使用者切到交易頁，新請求進來
    withRequestScope(req("transactions"), () => {
      assert.equal(inferRequestPriority(), "high");
    });

    // 同一個持股頁請求後續才要取名額時，已經該讓位了
    assert.equal(inferRequestPriority(), "low");
  });
});

test("使用者切回原本那一頁時，新請求回到高優先權", () => {
  withRequestScope(req("holdings"), () => {});
  withRequestScope(req("transactions"), () => {});
  withRequestScope(req("holdings"), () => {
    assert.equal(inferRequestPriority(), "high");
  });
});

test("背景預熱不會把使用者正在看的頁面擠成舊頁面", () => {
  withRequestScope(req("dashboard"), () => {});
  // idle 時預載持股頁；這不代表使用者切過去了
  withRequestScope(req("holdings", true), () => {
    assert.equal(inferRequestPriority(), "low");
  });
  // 總覽頁後續的請求仍然是高優先權
  withRequestScope(req("dashboard"), () => {
    assert.equal(inferRequestPriority(), "high");
  });
});

test("沒帶頁面 header 的請求維持高優先權（不影響既有呼叫端）", () => {
  withRequestScope(req("holdings"), () => {});
  withRequestScope(req(), () => {
    assert.equal(inferRequestPriority(), "high");
  });
});

test("巢狀 async 也能讀到同一個請求範圍", async () => {
  await withRequestScope(req("holdings"), async () => {
    withRequestScope(req("transactions"), () => {});
    await new Promise((r) => setTimeout(r, 5));
    // 切頁發生在這個請求進行中，await 之後仍要看得到自己的來源頁
    assert.equal(inferRequestPriority(), "low");
  });
});
