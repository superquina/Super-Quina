#!/usr/bin/env node

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "Safely create the first Super Quina administrator if none exists.\n" +
      "Required only when no administrator exists: DATABASE_URL, ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, CONFIRM_ADMIN_PROVISIONING=CREATE_FIRST_ADMIN.\n" +
      "The account is created with mustChangePassword=true. Never put credentials in source control.\n" +
      "If an administrator already exists, this command exits successfully without changing any account.\n",
    );
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to check administrator setup.");

  const [{ PrismaPg }, { PrismaClient }, { hashPassword }] = await Promise.all([
    import("@prisma/adapter-pg"),
    import("../src/generated/prisma/client.ts"),
    import("../src/lib/auth/password.ts"),
  ]);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Use executeRaw because pg_advisory_xact_lock returns PostgreSQL void,
      // which Prisma's queryRaw cannot deserialize.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(728194603112::bigint)`;
      const existingAdmin = await tx.user.findFirst({
        where: { role: "ADMIN" },
        select: { id: true, username: true },
      });
      if (existingAdmin) return { created: false, username: existingAdmin.username };

      const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
      const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
      const confirmation = process.env.CONFIRM_ADMIN_PROVISIONING;
      if (!username || !initialPassword || confirmation !== "CREATE_FIRST_ADMIN") {
        throw new Error("No administrator exists. Configure ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD and CONFIRM_ADMIN_PROVISIONING=CREATE_FIRST_ADMIN.");
      }
      if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
        throw new Error("ADMIN_USERNAME must be 3-50 characters: letters, numbers, dot, underscore or hyphen.");
      }
      if (initialPassword.length < 6) {
        throw new Error("ADMIN_INITIAL_PASSWORD must contain at least 6 characters.");
      }

      const existingUser = await tx.user.findUnique({ where: { username }, select: { id: true } });
      if (existingUser) throw new Error("That username already exists; bootstrap will not change existing accounts.");
      const passwordHash = await hashPassword(initialPassword);
      const created = await tx.user.create({
        data: { username, passwordHash, role: "ADMIN", status: "ACTIVE", mustChangePassword: true },
        select: { id: true, username: true },
      });
      return { created: true, username: created.username, id: created.id };
    });

    if (result.created) {
      process.stdout.write(`Created first administrator: ${result.username} (id ${result.id}). Sign in and change the initial password.\n`);
    } else {
      process.stdout.write(`Administrator already exists: ${result.username}. No account or password was changed.\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`Administrator provisioning failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
