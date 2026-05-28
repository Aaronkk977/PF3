import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "@/lib/app-data";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function sqliteUrlWithTimeout(url: string | undefined): string {
  const base = url ?? getDatabaseUrl();
  if (!base.startsWith("file:") || base.includes("socket_timeout=")) {
    return base;
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}socket_timeout=60`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: {
        url: sqliteUrlWithTimeout(
          process.env.DATABASE_URL ?? getDatabaseUrl(),
        ),
      },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
