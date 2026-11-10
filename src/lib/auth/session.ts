import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const globalForPrisma = globalThis as unknown as { authPrisma?: PrismaClient };
function createPrisma() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
const prisma = globalForPrisma.authPrisma ?? createPrisma();
if (process.env.NODE_ENV !== "production") globalForPrisma.authPrisma = prisma;

export const SESSION_COOKIE = "superquina_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { tokenHash: hashSessionToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function revokeSession(token: string | undefined) {
  if (!token) return;
  await prisma.session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getSessionUser(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findFirst({
    where: { tokenHash: hashSessionToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
    select: { user: { select: { id: true, username: true, role: true, status: true, mustChangePassword: true } } },
  });
  if (!session || session.user.status !== "ACTIVE") return null;
  return session.user;
}

export { prisma as authPrisma };
