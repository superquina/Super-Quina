import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { authPrisma } from "@/lib/auth/session";
import { closeRound } from "@/modules/rounds/close-round";
import { openRound } from "@/modules/rounds/open-round";
import { drawRoundResults } from "@/modules/rounds/draw-round-results";
import { settleNumericRoundPrizes } from "@/modules/rounds/settle-numeric-round-prizes";
import { reconcilePixPaymentFromProvider } from "@/modules/payments/reconcile-pix-payment";
import { allocatePaidPurchases } from "@/modules/purchases/allocate-paid-purchases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIME_ZONE = "Etc/GMT+3"; // Fixed UTC-03:00, as specified in docs/PRODUCT_SPEC.md
const HALF_HOUR_MS = 30 * 60_000;
const MINUTE_MS = 60_000;
const MAX_FUTURE_ROUNDS = 48;

function safeSecretMatch(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(`Bearer ${expected}`);
  return left.length === right.length && timingSafeEqual(left, right);
}

function brasiliaParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function wallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target + 3 * 60 * MINUTE_MS;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = brasiliaParts(new Date(candidate));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    candidate += target - represented;
  }
  return new Date(candidate);
}

function resultSlots(from: Date, through: Date): Date[] {
  const slots: Date[] = [];
  const local = brasiliaParts(from);
  const localMinute = Number(local.minute);
  const firstMinute = localMinute < 30 ? 0 : 30;
  let cursor = wallTimeToUtc(Number(local.year), Number(local.month), Number(local.day), Number(local.hour), firstMinute);
  // Skip only result instants that have already passed. If the scheduler starts during
  // the final cutoff minute, still create that round so it can close and draw on time.
  if (cursor.getTime() <= from.getTime()) {
    if (firstMinute === 0) {
      cursor = wallTimeToUtc(Number(local.year), Number(local.month), Number(local.day), Number(local.hour), 30);
    } else {
      const nextHour = new Date(Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour) + 1));
      cursor = wallTimeToUtc(nextHour.getUTCFullYear(), nextHour.getUTCMonth() + 1, nextHour.getUTCDate(), nextHour.getUTCHours(), 0);
    }
  }
  while (cursor.getTime() <= through.getTime()) {
    // Never create a brand-new round after its cutoff. Existing due rounds are
    // still processed below, but a fresh installation must not create a round
    // whose sales window has already ended.
    if (cursor.getTime() - MINUTE_MS >= from.getTime()) slots.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + HALF_HOUR_MS);
  }
  return slots;
}
function roundCode(date: Date): string {
  const parts = brasiliaParts(date);
  return `SQ-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

/**
 * Protected scheduler endpoint. Configure the hosting platform to POST to it every minute
 * with Authorization: Bearer <ROUND_SCHEDULER_SECRET>. It only manages scheduled rounds.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.ROUND_SCHEDULER_SECRET;
  if (!secret || !safeSecretMatch(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + (MAX_FUTURE_ROUNDS + 1) * HALF_HOUR_MS);
  let created = 0;
  let closed = 0;
  let drawn = 0;
  let prizesSettled = 0;
  let failures = 0;
  let pixChecked = 0;
  let pixConfirmed = 0;
  let pixNeedsReconciliation = 0;
  let paidPurchasesChecked = 0;
  let paidPurchasesAllocated = 0;
  let paidPurchasesWaiting = 0;

  // Maintain 48 upcoming 30-minute numeric rounds, covering the next 24 hours.
  // This endpoint still runs every minute for precise opening, cutoff, draw and Pix reconciliation.
  const slots = resultSlots(now, horizon).slice(0, MAX_FUTURE_ROUNDS);
  const existingRounds = await authPrisma.round.findMany({
    where: { resultAt: { in: slots }, status: { not: "CANCELLED" } },
    select: { resultAt: true },
  });
  const existingResultTimes = new Set(existingRounds.map((round) => round.resultAt.getTime()));
  for (const resultAt of slots) {
    const code = roundCode(resultAt);
    if (existingResultTimes.has(resultAt.getTime())) continue;
    try {
      const previous = await authPrisma.round.findFirst({
        where: { resultAt: { lt: resultAt }, status: { not: "CANCELLED" } },
        orderBy: { resultAt: "desc" },
        select: { resultAt: true },
      });
      const startsAt = previous ? new Date(previous.resultAt.getTime() + MINUTE_MS) : new Date(resultAt.getTime() - HALF_HOUR_MS + MINUTE_MS);
      const cutoffAt = new Date(resultAt.getTime() - MINUTE_MS);
      if (startsAt >= cutoffAt) continue;
      await authPrisma.$transaction(async (tx) => {
        const round = await tx.round.create({
          data: { code, startsAt, cutoffAt, resultAt, status: "SCHEDULED" },
          select: { id: true },
        });
        await tx.auditEvent.create({
          data: { action: "ROUND_SCHEDULED_AUTOMATICALLY", entityType: "Round", entityId: round.id,
            metadata: { code, startsAt: startsAt.toISOString(), cutoffAt: cutoffAt.toISOString(), resultAt: resultAt.toISOString(), timeZone: TIME_ZONE } },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      created += 1;
      existingResultTimes.add(resultAt.getTime());
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      failures += 1;
    }
  }

  // Allocate cash/wallet purchases whose funds were already accepted while the
  // scheduler had no complete sequence of future rounds available.
  try {
    const allocation = await allocatePaidPurchases(authPrisma, 50);
    paidPurchasesChecked = allocation.checked;
    paidPurchasesAllocated = allocation.allocated;
    paidPurchasesWaiting = allocation.waiting;
    failures += allocation.failures;
  } catch {
    failures += 1;
  }

  // Reconcile pending Pix orders independently of the browser. Closing the QR modal
  // must not disable the direct-provider fallback. updatedAt is only a throttle/claim,
  // never the game decision clock.
  const stalePendingPix = await authPrisma.payment.findMany({
    where: {
      provider: "MERCADO_PAGO",
      status: "PENDING",
      providerPaymentId: { not: null },
      updatedAt: { lt: new Date(now.getTime() - 10_000) },
    },
    select: { id: true },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: 50,
  });
  for (const payment of stalePendingPix) {
    const claimed = await authPrisma.payment.updateMany({
      where: {
        id: payment.id,
        status: "PENDING",
        updatedAt: { lt: new Date(now.getTime() - 10_000) },
      },
      data: { updatedAt: now },
    });
    if (claimed.count !== 1) continue;
    pixChecked += 1;
    try {
      const outcome = await reconcilePixPaymentFromProvider(authPrisma, payment.id);
      if (outcome === "confirmed" || outcome === "already_confirmed") pixConfirmed += 1;
      if (outcome === "late_or_unavailable") pixNeedsReconciliation += 1;
    } catch {
      failures += 1;
    }
  }

  // Process closures before draws; both operations lock the round and are safe to retry.
  const dueToClose = await authPrisma.round.findMany({
    where: { status: { in: ["SCHEDULED", "OPEN"] }, cutoffAt: { lte: now } },
    select: { id: true }, orderBy: { cutoffAt: "asc" }, take: 100,
  });
  for (const round of dueToClose) {
    try { await closeRound(authPrisma, round.id); closed += 1; } catch { failures += 1; }
  }

  const dueToOpen = await authPrisma.round.findMany({
    where: { status: "SCHEDULED", startsAt: { lte: now }, cutoffAt: { gt: now } },
    select: { id: true }, orderBy: { startsAt: "asc" }, take: 100,
  });
  for (const round of dueToOpen) {
    try { await openRound(authPrisma, round.id); } catch { failures += 1; }
  }

  const dueToDraw = await authPrisma.round.findMany({
    where: { status: "CLOSED", resultAt: { lte: now } },
    select: { id: true }, orderBy: { resultAt: "asc" }, take: 100,
  });
  for (const round of dueToDraw) {
    try { await drawRoundResults(authPrisma, round.id); drawn += 1; } catch { failures += 1; }
  }

  // Retry every completed round without a successful automatic settlement audit.
  // The settlement service locks the round and uses stable ledger idempotency keys.
  const dueToSettle = await authPrisma.$queryRaw<Array<{ id: string }>>`
    SELECT r."id"
    FROM "Round" r
    WHERE r."status" = 'COMPLETED'
      AND r."resultNumber" IS NOT NULL
      AND r."resultAt" <= ${now}
      AND NOT EXISTS (
        SELECT 1 FROM "AuditEvent" a
        WHERE a."entityType" = 'Round'
          AND a."entityId" = r."id"
          AND a."action" IN ('NUMERIC_ROUND_PRIZES_SETTLED', 'NUMERIC_ROUND_PRIZES_SETTLED_AUTOMATICALLY')
      )
    ORDER BY r."resultAt" ASC, r."id" ASC
    LIMIT 100
  `;
  for (const round of dueToSettle) {
    try {
      await settleNumericRoundPrizes(authPrisma, round.id);
      prizesSettled += 1;
    } catch {
      failures += 1;
    }
  }

  return NextResponse.json({
    ok: failures === 0, created, closed, drawn, prizesSettled, failures, timeZone: TIME_ZONE,
    pixChecked, pixConfirmed, pixNeedsReconciliation,
    paidPurchasesChecked, paidPurchasesAllocated, paidPurchasesWaiting,
  }, {
    status: failures === 0 ? 200 : 207, headers: { "Cache-Control": "no-store" },
  });
}
