import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
type RouteContext = { params: Promise<{ cashierId: string }> };

const updateSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  username: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(6).max(1024).optional().or(z.literal("")),
  whatsapp: z.string().trim().min(10).max(24),
  city: z.string().trim().max(120).optional().default(""),
  address: z.string().trim().max(200).optional().default(""),
  referencePoint: z.string().trim().max(200).optional().default(""),
  suppliesMaterial: z.boolean().optional().default(false),
  status: z.enum(["ACTIVE", "BLOCKED"]),
}).strict();

async function requireAdmin(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return { response: NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers }) };
  if (user.role !== "ADMIN" || user.mustChangePassword) return { response: NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers }) };
  return { user };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
    }
    // Keep the same reverse-proxy-safe origin check used by login.
    const requestHost = request.headers.get("host");
    if (!requestHost || originHost !== requestHost) {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
    }
  }
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const { cashierId } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(cashierId)) return NextResponse.json({ error: "Cambista não encontrado." }, { status: 404, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400, headers }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Confira os campos e use uma senha de pelo menos 6 caracteres quando for redefini-la." }, { status: 400, headers });
  const whatsapp = parsed.data.whatsapp.replace(/\D/g, "");
  if (whatsapp.length < 10 || whatsapp.length > 15) return NextResponse.json({ error: "Informe um WhatsApp válido com DDD e código do país, se aplicável." }, { status: 400, headers });

  try {
    const passwordHash = parsed.data.password ? await hashPassword(parsed.data.password) : undefined;
    const updated = await authPrisma.$transaction(async (tx) => {
      const previous = await tx.user.findFirst({
        where: { id: cashierId, role: "CASHIER" },
        select: { id: true, username: true, fullName: true, whatsapp: true, city: true, address: true, referencePoint: true, suppliesMaterial: true, commissionRateBasisPoints: true, status: true },
      });
      if (!previous) throw new Error("NOT_FOUND");
      const nextRate = parsed.data.suppliesMaterial ? 1000 : 2000;
      const nextUsername = parsed.data.username.toLowerCase();
      const cashier = await tx.user.update({
        where: { id: cashierId },
        data: {
          username: nextUsername,
          fullName: parsed.data.fullName,
          whatsapp,
          city: parsed.data.city || null,
          address: parsed.data.address || null,
          referencePoint: parsed.data.referencePoint || null,
          suppliesMaterial: parsed.data.suppliesMaterial,
          commissionRateBasisPoints: nextRate,
          status: parsed.data.status,
          ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
        },
        select: { id: true, username: true, fullName: true, whatsapp: true, city: true, address: true, referencePoint: true, suppliesMaterial: true, commissionRateBasisPoints: true, status: true, createdAt: true },
      });
      await tx.auditEvent.create({ data: {
        actorId: auth.user.id, action: "CASHIER_UPDATED", entityType: "User", entityId: cashier.id,
        metadata: {
          usernameBefore: previous.username, usernameAfter: cashier.username,
          fullNameBefore: previous.fullName, fullNameAfter: cashier.fullName,
          whatsappBefore: previous.whatsapp, whatsappAfter: cashier.whatsapp,
          cityBefore: previous.city, cityAfter: cashier.city,
          addressBefore: previous.address, addressAfter: cashier.address,
          referencePointBefore: previous.referencePoint, referencePointAfter: cashier.referencePoint,
          suppliesMaterialBefore: previous.suppliesMaterial, suppliesMaterialAfter: cashier.suppliesMaterial,
          commissionRateBasisPointsBefore: previous.commissionRateBasisPoints,
          commissionRateBasisPointsAfter: cashier.commissionRateBasisPoints,
          statusBefore: previous.status, statusAfter: cashier.status,
          passwordReset: Boolean(passwordHash),
        },
      } });
      return cashier;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ cashier: { ...updated, commissionPercent: updated.commissionRateBasisPoints / 100, createdAt: updated.createdAt.toISOString() } }, { headers });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Cambista não encontrado." }, { status: 404, headers });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Esse nome de usuário já está em uso." }, { status: 409, headers });
    return NextResponse.json({ error: "Não foi possível atualizar o cambista." }, { status: 500, headers });
  }
}
