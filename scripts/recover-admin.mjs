#!/usr/bin/env node

// One-time, explicit recovery for an administrator who cannot sign in.
// Does not create users and never modifies player accounts.
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const username = process.env.ADMIN_RECOVERY_USERNAME?.trim().toLowerCase();
  const password = process.env.ADMIN_RECOVERY_PASSWORD;
  const confirmation = process.env.CONFIRM_ADMIN_RECOVERY;

  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (confirmation !== "RESET_EXISTING_ADMIN") {
    throw new Error("Set CONFIRM_ADMIN_RECOVERY=RESET_EXISTING_ADMIN for this one-time recovery.");
  }
  if (!username || !/^[a-z0-9._-]{3,50}$/.test(username)) {
    throw new Error("ADMIN_RECOVERY_USERNAME must be a valid administrator username (3-50 characters).");
  }
  if (!password || password.length < 6 || Buffer.byteLength(password, "utf8") > 1024) {
    throw new Error("ADMIN_RECOVERY_PASSWORD must contain at least 6 characters.");
  }

  const [{ PrismaPg }, { PrismaClient }, { hashPassword }] = await Promise.all([
    import("@prisma/adapter-pg"),
    import("../src/generated/prisma/client.ts"),
    import("../src/lib/auth/password.ts"),
  ]);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const passwordHash = await hashPassword(password);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(728194603112::bigint)`;
      const admin = await tx.user.findUnique({
        where: { username },
        select: { id: true, username: true, role: true },
      });
      if (!admin || admin.role !== "ADMIN") {
        throw new Error("No administrator with that username was found. No account was changed.");
      }
      await tx.user.update({
        where: { id: admin.id },
        data: { passwordHash, mustChangePassword: true },
      });
      return admin.username;
    });
    process.stdout.write(`Administrator password recovered for: ${result}. Sign in and choose a new password.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Administrator recovery failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
