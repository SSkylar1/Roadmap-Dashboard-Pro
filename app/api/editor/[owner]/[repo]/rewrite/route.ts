import { NextRequest, NextResponse } from "next/server";

import { describeProjectFile, normalizeProjectKey } from "@/lib/project-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RewritePayload = {
  path?: string;
  content?: string;
  instructions?: string;
  branch?: string;
  project?: string | null;
  contextSummary?: string;
  blockers?: string[];
  statusLabel?: string;
};

type RewriteResponse = {
  ok: true;
  path: string;
  suggestion: string;
};

function normalizePath(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^\/+/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function buildPrompt(payload: RewritePayload, projectKey: string | null): string {
  const targetPath = normalizePath(typeof payload.path === "string" ? payload.path : null) ?? "the target file";
  const describedPath = projectKey ? describeProjectFile(targetPath, projectKey) : targetPath;
  const instructions = typeof payload.instructions === "string" && payload.instructions.trim().length > 0
    ? payload.instructions.trim()
    : "Make concise wording adjustments so roadmap checks will recognize the update as complete.";
  const contextSummary = typeof payload.contextSummary === "string" && payload.contextSummary.trim().length > 0
    ? payload.contextSummary.trim()
    : null;
  const blockers = Array.isArray(payload.blockers) ? payload.blockers.filter((entry) => typeof entry === "string" && entry.trim()) : [];
  const blockersSection = blockers.length
    ? `\n\nChecks still failing:\n${blockers.map((entry) => `- ${entry}`).join("\n")}`
    : "";
  const statusLabel = typeof payload.statusLabel === "string" && payload.statusLabel.trim().length > 0 ? payload.statusLabel.trim() : null;

  return (
    `You are a meticulous editor improving delivery checklists. Update ${describedPath} by adjusting wording only. ` +
    `Maintain formatting, YAML structure, and existing sections. Do not invent new data or remove required fields. ` +
    `Return the full updated file contents with no commentary.` +
    `\n\nEditing goal:\n${instructions}` +
    (statusLabel ? `\n\nCurrent status: ${statusLabel}` : "") +
    (contextSummary ? `\n\nRoadmap summary:\n${contextSummary}` : "") +
    blockersSection +
    `\n`
  );
}

export async function POST(req: NextRequest) {
  let payload: RewritePayload;
  try {
    payload = (await req.json()) as RewritePayload;
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const path = normalizePath(typeof payload.path === "string" ? payload.path : null);
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const content = typeof payload.content === "string" ? payload.content : null;
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const projectKey = normalizeProjectKey(payload.project ?? null);

  const openAiKey = req.headers.get("x-openai-key")?.trim() || process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    return NextResponse.json(
      {
        error: "missing_openai_key",
        detail: "Add an OpenAI API key in Settings to use the smart editor.",
      },
      { status: 500 },
    );
  }

  const prompt = buildPrompt(payload, projectKey ?? null);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You help engineers make minimal wording edits so automated roadmap checks pass. Preserve structure and respond with valid output only.",
        },
        {
          role: "user",
          content: `${prompt}\n\nExisting content:\n\n${content}`,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json(
      { error: "openai_error", detail: detail.slice(0, 400) },
      { status: response.status },
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const suggestion = data.choices?.[0]?.message?.content?.trim();
  if (!suggestion) {
    return NextResponse.json({ error: "empty_response" }, { status: 502 });
  }

  return NextResponse.json(
    {
      ok: true,
      path: describeProjectFile(path, projectKey),
      suggestion,
    } satisfies RewriteResponse,
    { status: 200 },
  );
}
