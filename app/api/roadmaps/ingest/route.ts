import { NextRequest, NextResponse } from "next/server";
import YAML from "yaml";
import { RoadmapDoc, normalize } from "@/lib/roadmap/schema";
import { createClient } from "@supabase/supabase-js";

import { STANDALONE_MODE } from "@/lib/config";

export const runtime = "nodejs";

function computeStatus(normalized: { title: string; items: any[] }) {
  const problems:string[] = [];
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

export async function POST(req: NextRequest) {
  try {
    const { workspaceId, format, source } = await req.json() as {
      workspaceId: string; format: "yaml" | "json"; source: string;
    };

    if (!workspaceId || !format || !source) {
      return NextResponse.json({ ok:false, error:"missing_fields" }, { status: 400 });
    }

    if (STANDALONE_MODE) {
      return NextResponse.json(
        { ok:false, error:"standalone_mode" },
        { status: 503 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        { ok:false, error:"supabase_not_configured" },
        { status: 503 },
      );
    }

    let parsed: unknown;
    try {
      parsed = format === "yaml" ? YAML.parse(source) : JSON.parse(source);
    } catch (e:any) {
      return NextResponse.json({ ok:false, error:"parse_error", detail: e.message }, { status: 400 });
    }

    const check = RoadmapDoc.safeParse(parsed);
    if (!check.success) {
      return NextResponse.json({ ok:false, error:"schema_error", detail: check.error.format() }, { status: 400 });
    }

    const normalized = normalize(check.data);
    const status = computeStatus(normalized);

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data, error } = await supabase
      .from("roadmaps")
      .insert({
        workspace_id: workspaceId,
        title: normalized.title ?? "Untitled Roadmap",
        format,
        source,
        normalized,
        status,
        is_current: true
      })
      .select()
      .single();

    if (error) return NextResponse.json({ ok:false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok:true, roadmap: data });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: String(e.message || e) }, { status: 500 });
  }
}
