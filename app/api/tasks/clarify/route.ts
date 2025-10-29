import { NextResponse } from "next/server";

type ClarifyRequest = {
  itemName?: string;
  description?: string;
  weekTitle?: string | null;
  followUpQuestions?: string[];
  answers?: string[];
  extraContext?: string;
};

function normalizeArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

export async function POST(req: Request) {
  let body: ClarifyRequest;
  try {
    body = (await req.json()) as ClarifyRequest;
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const itemName = typeof body?.itemName === "string" ? body.itemName.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const extraContext = typeof body?.extraContext === "string" ? body.extraContext.trim() : "";
  const answers = normalizeArray(body?.answers);
  const followUpQuestions = normalizeArray(body?.followUpQuestions);
  const weekTitle = typeof body?.weekTitle === "string" ? body.weekTitle.trim() : "";

  if (!itemName && !description) {
    return NextResponse.json({ error: "Provide an itemName or description" }, { status: 400 });
  }

  const openAiKey = req.headers.get("x-openai-key")?.trim() || process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    return NextResponse.json(
      {
        error: "OpenAI API key missing",
        detail: "Add an OpenAI key in Settings to enable clarification prompts.",
      },
      { status: 500 },
    );
  }

  const promptSections = [
    `Roadmap item: ${itemName || "(missing title)"}`,
    description ? `Existing notes: ${description}` : null,
    weekTitle ? `Week or phase: ${weekTitle}` : null,
  ].filter(Boolean) as string[];

  if (followUpQuestions.length > 0) {
    promptSections.push(`Open questions: ${followUpQuestions.join(" | ")}`);
  }
  if (answers.length > 0) {
    promptSections.push(`Team answers: ${answers.join(" | ")}`);
  }
  if (extraContext) {
    promptSections.push(`Additional context: ${extraContext}`);
  }

  const payload = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system" as const,
        content:
          "You help product teams clarify roadmap tasks. " +
          "Always reply with a JSON object containing clarityScore, missingDetails, followUpQuestions, and summary.",
      },
      {
        role: "user" as const,
        content:
          `${promptSections.join("\n")}\n\n` +
          "Based on the new context, return JSON with:\n" +
          "- clarityScore: number between 0 and 1.\n" +
          "- missingDetails: array of short bullet points summarizing what is still unclear.\n" +
          "- followUpQuestions: array of focused questions if more context is required (empty array if satisfied).\n" +
          "- summary: short reassuring sentence if the task is now clear.",
      },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: "Failed to reach OpenAI", detail: errorText.slice(0, 400) },
      { status: response.status },
    );
  }

  const data = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return NextResponse.json({ error: "OpenAI response was empty" }, { status: 502 });
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return NextResponse.json({ error: "Unable to parse OpenAI response" }, { status: 502 });
  }

  const clarityScore =
    typeof parsed.clarityScore === "number"
      ? Math.max(0, Math.min(1, parsed.clarityScore))
      : undefined;
  const missingDetails = normalizeArray(parsed.missingDetails);
  const followUps = normalizeArray(parsed.followUpQuestions);
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : undefined;

  if (clarityScore === undefined && missingDetails.length === 0 && followUps.length === 0 && !summary) {
    return NextResponse.json({ error: "OpenAI response was incomplete" }, { status: 502 });
  }

  return NextResponse.json({ clarityScore, missingDetails, followUpQuestions: followUps, summary });
}
