import { NextResponse } from "next/server";

const SYSTEM_PROMPT = "Generate a YAML roadmap with weeks/items in docs/roadmap.yml format.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeInput(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeInput(entry)).filter(Boolean).join("\n\n");
  }
  if (value && typeof value === "object") {
    return normalizeInput(Object.values(value));
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompt = normalizeInput((body as { prompt?: unknown })?.prompt);

    if (!prompt) {
      return NextResponse.json({ error: "Provide concept text or an uploaded document" }, { status: 400 });
    }

    const headerKey = req.headers.get("x-openai-key")?.trim();
    const apiKey = headerKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "OpenAI API key is not configured",
          detail: "Add a key in Settings so the wizard can generate a roadmap.",
        },
        { status: 500 },
      );
    }

    const payload = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Context from founder or product lead describing the concept. Generate docs/roadmap.yml YAML.\n\n" + prompt,
        },
      ],
      temperature: 0.2,
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: "Failed to generate roadmap", detail: errorText.slice(0, 400) },
        { status: response.status },
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const roadmap = data.choices?.[0]?.message?.content?.trim();

    if (!roadmap) {
      return NextResponse.json({ error: "OpenAI response was empty" }, { status: 502 });
    }

    return NextResponse.json({ roadmap });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Unexpected error" }, { status: 500 });
  }
}
