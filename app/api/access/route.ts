import { ACCESS_COOKIE, accessRequired, accessToken, hasAccess } from "@/lib/access";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return Response.json({ required: accessRequired(), ok: hasAccess(req) });
}

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const token = accessToken(String(password ?? ""));
  if (!token) return Response.json({ ok: false, message: "That password isn't right." }, { status: 401 });
  const res = Response.json({ ok: true });
  res.headers.append("set-cookie", `${ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 30}`);
  return res;
}
