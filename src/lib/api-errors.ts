import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/service-error";

/** 把 service 層丟出的 ServiceError 轉成 `{ error }` JSON 回應；不是 ServiceError
 *  的例外原樣丟出，交給 Next.js 當 500 處理。 */
export function serviceErrorResponse(err: unknown): NextResponse {
  if (err instanceof ServiceError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}
