// app/api/ping/route.ts
export const runtime = "nodejs";
export async function GET() {
  return new Response(JSON.stringify({ ok: true, route: "ping" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}