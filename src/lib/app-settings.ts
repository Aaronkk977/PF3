import { prisma } from "@/lib/db";
import { ServiceError } from "@/lib/service-error";
import {
  isSyncedSettingKey,
  toStoredSettingValue,
} from "@/lib/setting-keys";

/** 使用者設定的資料庫讀寫（AppSetting 表，值存 JSON 字串）。 */

const MAX_VALUE_BYTES = 64 * 1024;

/** 全部設定，key → 已解析的值。資料表還不存在（還沒跑 migration）時回傳空物件，
 *  不要讓整個頁面因為設定讀不到而掛掉。 */
export async function getAllAppSettings(): Promise<Record<string, unknown>> {
  try {
    const rows = await prisma.appSetting.findMany();
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        // 壞掉的值當作沒設定
      }
    }
    return out;
  } catch (err) {
    console.error("Failed to read app settings", err);
    return {};
  }
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  if (!isSyncedSettingKey(key)) {
    throw new ServiceError(`不支援的設定：${key}`);
  }
  if (value === undefined) {
    throw new ServiceError("缺少設定值");
  }
  const json = JSON.stringify(toStoredSettingValue(key, value));
  if (json.length > MAX_VALUE_BYTES) {
    throw new ServiceError("設定值過大");
  }
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: json },
    update: { value: json },
  });
}
