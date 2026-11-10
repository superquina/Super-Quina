import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;

suite("PostgreSQL Mercado Pago webhook event claims", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (enabled) {
    if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");
    const parsed = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(parsed.hostname) ||
        parsed.pathname.replace(/^\//, "").split("?")[0] !== "superquina_test") {
      throw new Error("Refusing to run webhook claim integration tests outside the local superquina_test database");
    }
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const providerEventId = `it-webhook-claim-${randomUUID()}`;
  let eventId = "";

  beforeAll(async () => {
    await prisma.$connect();
    const event = await prisma.webhookEvent.create({
      data: {
        provider: "MERCADO_PAGO",
        providerEventId,
        eventType: "order",
        payloadDigest: "integration-test",
      },
      select: { id: true },
    });
    eventId = event.id;
  });

  afterAll(async () => {
    if (eventId) await prisma.webhookEvent.deleteMany({ where: { id: eventId } });
    await prisma.$disconnect();
  });

  it("grants one processing claim to overlapping deliveries and only that claim can complete the event", async () => {
    const tokens = [
      `processing:${Date.now()}:delivery-a`,
      `processing:${Date.now()}:delivery-b`,
    ];

    const claims = await Promise.all(tokens.map((token) => prisma.webhookEvent.updateMany({
      where: { id: eventId, processedAt: null, processingError: null },
      data: { processingError: token },
    })));

    expect(claims.map((claim) => claim.count).sort()).toEqual([0, 1]);

    const saved = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { processingError: true, processedAt: true },
    });
    expect(tokens).toContain(saved.processingError);
    expect(saved.processedAt).toBeNull();

    const winningToken = saved.processingError!;
    const completed = await prisma.webhookEvent.updateMany({
      where: { id: eventId, processedAt: null, processingError: winningToken },
      data: { processedAt: new Date(), processingError: null },
    });
    const staleCompletion = await prisma.webhookEvent.updateMany({
      where: { id: eventId, processedAt: null, processingError: tokens.find((token) => token !== winningToken)! },
      data: { processedAt: new Date(), processingError: null },
    });

    expect(completed.count).toBe(1);
    expect(staleCompletion.count).toBe(0);
    const finalEvent = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { processedAt: true, processingError: true },
    });
    expect(finalEvent.processedAt).toBeInstanceOf(Date);
    expect(finalEvent.processingError).toBeNull();
  });
});
