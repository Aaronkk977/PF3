import { NextRequest, NextResponse } from "next/server";
import { importCsv } from "@/lib/csv-import";
import { importLegacyCsv } from "@/lib/legacy-csv-import";
import { invalidatePerformanceCache } from "@/lib/performance-cache";

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  let content: string;
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "請上傳 CSV 檔案" }, { status: 400 });
    }
    content = await file.text();
  } else {
    const body = await request.json();
    content = body.content ?? body.csv ?? "";
  }

  if (!content.trim()) {
    return NextResponse.json({ error: "CSV 內容為空" }, { status: 400 });
  }

  const isLegacy =
    content.toLowerCase().includes("security") &&
    content.toLowerCase().includes("shares");

  const result = isLegacy
    ? await importLegacyCsv(content)
    : await importCsv(content);

  if (!isLegacy) {
    await invalidatePerformanceCache();
  }

  return NextResponse.json(result);
}
