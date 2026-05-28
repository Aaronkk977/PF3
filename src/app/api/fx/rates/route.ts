import { NextRequest, NextResponse } from "next/server";
import { formatExchangeRateLabel } from "@/lib/fx-display";
import { getExchangeRate, normalizeCurrencyCode } from "@/lib/fx-rates";

export async function GET(request: NextRequest) {
  const base = normalizeCurrencyCode(
    request.nextUrl.searchParams.get("base") ?? "TWD",
  );
  const codesParam = request.nextUrl.searchParams.get("codes");
  const codes = codesParam
    ? codesParam
        .split(",")
        .map((c) => normalizeCurrencyCode(c))
        .filter(Boolean)
    : ["TWD", "USD"];

  const unique = [...new Set([base, ...codes])];

  const rates = await Promise.all(
    unique.map(async (code) => {
      const rateToBase =
        code === base ? 1 : await getExchangeRate(code, base);
      return {
        code,
        rateToBase,
        label: formatExchangeRateLabel(code, base, rateToBase),
      };
    }),
  );

  const usdToTwd = await getExchangeRate("USD", "TWD");

  return NextResponse.json({ base, usdToTwd, rates });
}
