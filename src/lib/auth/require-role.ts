import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";

type Role = "PLAYER" | "CASHIER" | "ADMIN";
const routeByRole: Record<Role, string> = { PLAYER: "/player", CASHIER: "/cashier", ADMIN: "/admin" };

export async function requireRole(role: Role) {
  const cookieStore = await cookies();
  const user = await getSessionUser(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/login?reason=password-change-required");
  if (user.role !== role) redirect(routeByRole[user.role as Role] ?? "/login");
  return user;
}