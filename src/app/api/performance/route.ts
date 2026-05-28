import { NextRequest, NextResponse } from "next/server";
import { normalizePeriodDates } from "@/lib/date-keys";
import { getPerformance } from "@/lib/performance";
import {
  buildPerformanceCacheKey,
  getCachedPerformance,
  setCachedPerformance,
} from "@/lib/performance-cache";

function parseRequest(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const start = params.get("start");
  const end = params.get("end");
  const force = params.get("force") === "1";
  const stream = params.get("stream") === "1";

  const accountsParam = params.get("accounts") ?? "";
  const benchmarkParam =
    params.get("benchmarks") ?? params.get("benchmark") ?? "0050.TW";

  const accountIds = accountsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const benchmarkSymbols = benchmarkParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const periodEndRaw = end ? new Date(`${end}T12:00:00`) : new Date();
  const periodStartRaw = start
    ? new Date(`${start}T12:00:00`)
    : new Date(
        periodEndRaw.getFullYear() - 1,
        periodEndRaw.getMonth(),
        periodEndRaw.getDate(),
      );

  const { periodStart, periodEnd } = normalizePeriodDates(
    periodStartRaw,
    periodEndRaw,
  );

  const startStr = periodStart.toISOString().slice(0, 10);
  const endStr = periodEnd.toISOString().slice(0, 10);
  const accountsKey = accountIds.length > 0 ? accountIds.join(",") : "all";
  const benchesKey = benchmarkSymbols.join(",") || "none";
  const cacheKey = buildPerformanceCacheKey(
    startStr,
    endStr,
    accountsKey,
    benchesKey,
  );

  return {
    force,
    stream,
    periodStart,
    periodEnd,
    startStr,
    endStr,
    benchesKey,
    cacheKey,
    accountIds,
    benchmarkSymbols,
  };
}

export async function GET(request: NextRequest) {
  const {
    force,
    stream,
    periodStart,
    periodEnd,
    startStr,
    endStr,
    benchesKey,
    cacheKey,
    accountIds,
    benchmarkSymbols,
  } = parseRequest(request);

  const options = {
    accountIds: accountIds.length > 0 ? accountIds : undefined,
    benchmarkSymbols:
      benchmarkSymbols.length > 0 ? benchmarkSymbols : undefined,
  };

  if (stream) {
    const body = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;

        const closeStream = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed (e.g. client disconnected)
          }
        };

        const send = (payload: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`${JSON.stringify(payload)}\n`),
            );
          } catch {
            closed = true;
          }
        };

        const onAbort = () => {
          closed = true;
        };
        if (!request.signal.aborted) {
          request.signal.addEventListener("abort", onAbort, { once: true });
        } else {
          closed = true;
        }

        try {
          if (!force) {
            const cached = await getCachedPerformance(cacheKey);
            if (cached) {
              send({ type: "progress", phase: "使用伺服器快取", percent: 100 });
              send({ type: "done", result: { ...cached, fromCache: true } });
              return;
            }
          }

          const result = await getPerformance(
            periodStart,
            periodEnd,
            options,
            (update) => send({ type: "progress", ...update }),
          );
          if (closed) return;
          await setCachedPerformance(
            cacheKey,
            startStr,
            endStr,
            benchesKey,
            result,
          );
          send({ type: "done", result: { ...result, fromCache: false } });
        } catch (e) {
          console.error(e);
          send({
            type: "error",
            message: e instanceof Error ? e.message : "績效計算失敗",
          });
        } finally {
          request.signal.removeEventListener("abort", onAbort);
          closeStream();
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  try {
    if (!force) {
      const cached = await getCachedPerformance(cacheKey);
      if (cached) {
        return NextResponse.json({ ...cached, fromCache: true });
      }
    }

    const result = await getPerformance(periodStart, periodEnd, options);
    await setCachedPerformance(cacheKey, startStr, endStr, benchesKey, result);
    return NextResponse.json({ ...result, fromCache: false });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "績效計算失敗" },
      { status: 500 },
    );
  }
}
