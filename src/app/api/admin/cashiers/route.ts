import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authPrisma, getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

async function requireAdmin(request: NextRequest) {
  const user = await getSessionUser(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return { response: NextResponse.json({ error: "É necessário entrar na conta." }, { status: 401, headers }) };
  if (user.role !== "ADMIN" || user.mustChangePassword) return { response: NextResponse.json({ error: "Acesso não permitido." }, { status: 403, headers }) };
  return { user };
}

const profileSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  username: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_.-]+$/),
  password: z.string().min(6).max(1024),
  whatsapp: z.string().trim().min(10).max(24),
  commissionPercent: z.number().finite().min(0).max(100).refine((value) => Number.isInteger(value * 100), "Use até duas casas decimais."),
}).strict();

function normalizeWhatsapp(value: string) {
  return value.replace(/\D/g, "");
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  try {
    const params = request.nextUrl.searchParams;
    const requestedPage = Number(params.get("page") ?? "1");
    const requestedLimit = Number(params.get("limit") ?? "50");
    const search = (params.get("q") ?? "").trim().slice(0, 120);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 ||
        !Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      return NextResponse.json({ error: "Parâmetros de paginação inválidos." }, { status: 400, headers });
    }
    const where: Prisma.UserWhereInput = { role: "CASHIER", ...(search ? { OR: [
      { fullName: { contains: search, mode: "insensitive" } },
      { username: { contains: search, mode: "insensitive" } },
      { whatsapp: { contains: search } },
    ] } : {}) };
    const [total, cashiers] = await Promise.all([
      authPrisma.user.count({ where }),
      authPrisma.user.findMany({
        where,
        select: { id: true, username: true, fullName: true, whatsapp: true, commissionRateBasisPoints: true, status: true, mustChangePassword: true, createdAt: true },
        orderBy: [{ status: "asc" }, { username: "asc" }, { id: "asc" }],
        skip: (requestedPage - 1) * requestedLimit,
        take: requestedLimit,
      }),
    ]);
    const totalPages = Math.ceil(total / requestedLimit);
    return NextResponse.json({ cashiers: cashiers.map((cashier) => ({
      ...cashier,
      commissionPercent: cashier.commissionRateBasisPoints / 100,
      createdAt: cashier.createdAt.toISOString(),
    })), pagination: { page: requestedPage, limit: requestedLimit, total, totalPages, hasPreviousPage: requestedPage > 1, hasNextPage: requestedPage < totalPages } }, { headers });
  } catch {
    return NextResponse.json({ error: "Não foi possível carregar os cambistas." }, { status: 500, headers });
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
    }
    // Railway terminates public HTTPS before forwarding to Next.js. Compare
    // the browser Origin with the incoming Host, not the reconstructed URL.
    const requestHost = request.headers.get("host");
    if (!requestHost || originHost !== requestHost) {
      return NextResponse.json({ error: "Requisição inválida." }, { status: 403, headers });
    }
  }
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400, headers }); }
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Informe nome completo, usuário válido, senha com pelo menos 6 caracteres, WhatsApp e comissão de 0% a 100%." }, { status: 400, headers });
  const whatsapp = normalizeWhatsapp(parsed.data.whatsapp);
  if (whatsapp.length < 10 || whatsapp.length > 15) return NextResponse.json({ error: "Informe um WhatsApp válido com DDD e código do país, se aplicável." }, { status: 400, headers });
  const username = parsed.data.username.toLowerCase();
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const cashier = await authPrisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username, passwordHash, role: "CASHIER", status: "ACTIVE", mustChangePassword: true,
          fullName: parsed.data.fullName, whatsapp,
          commissionRateBasisPoints: Math.round(parsed.data.commissionPercent * 100),
        },
        select: { id: true, username: true, fullName: true, whatsapp: true, commissionRateBasisPoints: true, status: true, createdAt: true },
      });
      await tx.auditEvent.create({ data: {
        actorId: auth.user.id, action: "CASHIER_CREATED", entityType: "User", entityId: created.id,
        metadata: { username: created.username, fullName: created.fullName, whatsapp: created.whatsapp, commissionRateBasisPoints: created.commissionRateBasisPoints },
      } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ cashier: { ...cashier, commissionPercent: cashier.commissionRateBasisPoints / 100, createdAt: cashier.createdAt.toISOString() } }, { status: 201, headers });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Esse nome de usuário já está em uso." }, { status: 409, headers });
    return NextResponse.json({ error: "Não foi possível cadastrar o cambista." }, { status: 500, headers });
  }
}
