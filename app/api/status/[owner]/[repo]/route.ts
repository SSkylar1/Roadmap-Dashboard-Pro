import { NextRequest, NextResponse } from "next/server";
import { getFileRaw } from "@/lib/github";
export async function GET(_req:NextRequest, { params }:{ params:{ owner:string; repo:string }}) {
  try {
    const raw = await getFileRaw(params.owner, params.repo, "docs/roadmap-status.json").catch(()=>null);
    if (!raw) return NextResponse.json({ error:"not_found" }, { status:404 });
    return NextResponse.json(JSON.parse(raw));
  } catch (e:any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status:500 });
  }
}
