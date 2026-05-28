/**
 * SQLite stores some DateTime columns as "YYYY-MM-DD HH:MM:SS" after schema
 * migrations; Prisma expects ISO-8601. Run: npx tsx scripts/repair-datetimes.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isoFromSqliteDatetime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return new Date().toISOString();
  if (trimmed.includes("T")) return trimmed.endsWith("Z") ? trimmed : `${trimmed}Z`;
  const normalized = trimmed.replace(" ", "T");
  return normalized.endsWith("Z") ? normalized : `${normalized}.000Z`;
}

async function repairTable(table: "Account" | "Transaction", columns: string[]) {
  for (const col of columns) {
    const rows = await prisma.$queryRawUnsafe<{ id: string; value: string }[]>(
      `SELECT id, "${col}" as value FROM "${table}" WHERE "${col}" LIKE '% %'`,
    );
    for (const row of rows) {
      const fixed = isoFromSqliteDatetime(row.value);
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "${col}" = ? WHERE id = ?`,
        fixed,
        row.id,
      );
    }
    if (rows.length > 0) {
      console.log(`Fixed ${rows.length} row(s) in ${table}.${col}`);
    }
  }
}

async function main() {
  await repairTable("Account", ["createdAt", "updatedAt"]);
  await repairTable("Transaction", ["createdAt", "updatedAt"]);
  console.log("DateTime repair complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
