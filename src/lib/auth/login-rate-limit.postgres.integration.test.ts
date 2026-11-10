import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import {
  LOGIN_MAX_ATTEMPTS,
  clearLoginFailures,
  getLoginBlock,
  recordLoginFailure,
} from "./login-rate-limit";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

suite("PostgreSQL login rate limit", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (enabled && !databaseUrl) {
    throw new Error("DATABASE_URL is required when RUN_POSTGRES_INTEGRATION=1");
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });
  const suffix = randomUUID();
  const usernames = [
    `it-login-concurrent-${suffix}`,
    `it-login-window-${suffix}`,
    `it-login-clear-${suffix}`,
  ];

  const keyHash = (username: string) =>
    createHash("sha256")
      .update(`login-account:v1:${username.trim().toLocaleLowerCase("en-US")}`)
      .digest("hex");

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.loginAttemptBucket.deleteMany({
      where: { keyHash: { in: usernames.map(keyHash) } },
    });
    await prisma.$disconnect();
  });

  it("atomically counts concurrent failures and blocks at the threshold", async () => {
    const username = usernames[0]!;
    const now = new Date("2035-01-01T12:00:00.000Z");

    const results = await Promise.all(
      Array.from({ length: LOGIN_MAX_ATTEMPTS }, () =>
        recordLoginFailure(prisma, username, now),
      ),
    );

    expect(results.map((result) => result.attempts).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5]);
    expect(results.filter((result) => result.blocked)).toHaveLength(1);
    expect(await getLoginBlock(prisma, username, now)).toMatchObject({
      retryAfterSeconds: 900,
      blockedUntil: new Date(now.getTime() + 15 * 60 * 1000),
    });

    const bucket = await prisma.loginAttemptBucket.findUniqueOrThrow({
      where: { keyHash: keyHash(username) },
    });
    expect(bucket.attempts).toBe(LOGIN_MAX_ATTEMPTS);
    expect(bucket.blockedUntil).toEqual(new Date(now.getTime() + 15 * 60 * 1000));
  });

  it("resets the attempt window after fifteen minutes", async () => {
    const username = usernames[1]!;
    const now = new Date("2035-01-01T12:00:00.000Z");

    for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS - 1; attempt += 1) {
      await recordLoginFailure(prisma, username, now);
    }
    const reset = await recordLoginFailure(
      prisma,
      username,
      new Date(now.getTime() + 15 * 60 * 1000 + 1),
    );

    expect(reset.attempts).toBe(1);
    expect(reset.blocked).toBe(false);
    expect(await getLoginBlock(prisma, username, new Date(now.getTime() + 16 * 60 * 1000))).toBeNull();
  });

  it("clears the persisted bucket after successful authentication", async () => {
    const username = usernames[2]!;
    await recordLoginFailure(prisma, username, new Date("2035-01-01T12:00:00.000Z"));
    expect(await prisma.loginAttemptBucket.count({ where: { keyHash: keyHash(username) } })).toBe(1);

    await clearLoginFailures(prisma, username);

    expect(await prisma.loginAttemptBucket.count({ where: { keyHash: keyHash(username) } })).toBe(0);
    expect(await getLoginBlock(prisma, username, new Date("2035-01-01T12:01:00.000Z"))).toBeNull();
  });
});
