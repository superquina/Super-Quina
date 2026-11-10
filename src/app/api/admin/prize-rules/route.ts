import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { DEFAULT_NUMERIC_PRIZE_MULTIPLIERS, parseNumericPrizeMultipliers } from "@/domain/numeric-prize-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SETTING_KEY = "numeric_prize_multipliers";
const schema = z.object({
  unit: z.number().int().min(0).max(1_000_000),
  tens: z.number().int().min(0).max(1_000_000),
  hundreds: z.number().int().min(0).max(1_000_000),
  thousands: z.number().int().min(0).max(1_000_000),
  quina: z.number().int().min(0).max(1_000_000),
}).strict();

async function admin(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return { error: NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  if (user.role !== "ADMIN" || user.mustChangePassword) {
    return { error: NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers: { "Cache-Control": "no-store" } }) };
  }
  return { user };
}

function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.host.toLowerCase() === host;
  } catch { return false; }
}

export async function GET(request: NextRequest) {
  const access = await admin(request);
  if ("error" in access) return access.error;
  try {
    const setting = await authPrisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const value = setting ? parseNumericPrizeMultipliers(JSON.parse(setting.value)) : DEFAULT_NUMERIC_PRIZE_MULTIPLIERS;
    if (!value) throw new Error("Invalid stored multiplier configuration");
    return NextResponse.json({ multipliers: value, updatedAt: setting?.updatedAt.toISOString() ?? null }, { headers: { "Cache-Control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar os multiplicadores salvos." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: NextRequest) {
  const access = await admin(request);
  if ("error" in access) return access.error;
  if (!validOrigin(request)) return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success || !parseNumericPrizeMultipliers(body)) {
    return NextResponse.json({ error: "Informe multiplicadores inteiros entre 0 e 1.000.000." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const nextValue = JSON.stringify(parsed.data);
  try {
    const result = await authPrisma.$transaction(async (tx) => {
      const previous = await tx.setting.findUnique({ where: { key: SETTING_KEY } });
      const setting = await tx.setting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: nextValue },
        update: { value: nextValue },
      });
      await tx.settingChange.create({
        data: { settingKey: SETTING_KEY, oldValue: previous?.value ?? null, newValue: nextValue, changedById: access.user.id },
      });
      await tx.auditEvent.create({
        data: {
          actorId: access.user.id,
          action: "NUMERIC_PRIZE_MULTIPLIERS_UPDATED",
          entityType: "Setting",
          entityId: SETTING_KEY,
          metadata: { oldValue: previous?.value ?? null, newValue: nextValue },
        },
      });
      return setting;
    });
    return NextResponse.json({ multipliers: parsed.data, updatedAt: result.updatedAt.toISOString(), message: "Multiplicadores salvos. Novas apostas usarão estes valores." }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível salvar os multiplicadores. Nenhuma alteração foi confirmada." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
