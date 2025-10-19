import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { STANDALONE_MODE } from "@/lib/config";

export const runtime = "nodejs";

function computeStatus(normalized: { items: any[] }) {
  const problems: string[] = [];
  const dedupe = new Set<string>();
  for (const it of normalized.items) {
    if (dedupe.has(it.id)) problems.push(`Duplicate id: ${it.id}`);
    dedupe.add(it.id);
  }
  const counts = normalized.items.reduce<Record<string, number>>((m, it) => {
    const k = it.status ?? "todo";
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  return { problems, counts, total: normalized.items.length };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (STANDALONE_MODE) {
    return NextResponse.json({ ok: false, error: "standalone_mode" }, { status: 503 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return NextResponse.json(
      { ok: false, error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const id = params.id;
  const { data, error } = await supabase
    .from("roadmaps")
    .select("id, normalized")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message || "not_found" },
      { status: 404 },
    );
  }

  const status = computeStatus(data.normalized);
  const upd = await supabase
    .from("roadmaps")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (upd.error) {
    return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status });
}
