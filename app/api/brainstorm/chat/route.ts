import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequestBody = {
  conversationId?: string;
  history?: ClientMessage[];
  message?: string;
};

const SYSTEM_PROMPT =
  "You are an ideation partner helping founders expand product ideas into detailed opportunities. " +
  "Ask clarifying questions, suggest adjacent opportunities, and help them shape a concept into something actionable.";

async function ensureIdeasFile(conversationId: string) {
  const ideasDir = path.join("/tmp", "ideas");
  await fs.mkdir(ideasDir, { recursive: true });
  const filePath = path.join(ideasDir, `${conversationId}.md`);
  try {
    await fs.access(filePath);
  } catch {
    const header = `# Brainstorm Session ${conversationId}\n\n`;
    await fs.writeFile(filePath, header, "utf8");
  }
  return filePath;
}

function normalizeHistory(history?: ClientMessage[]): ClientMessage[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((message): message is ClientMessage => {
      if (!message || typeof message !== "object") {
        return false;
      }
      return (message.role === "user" || message.role === "assistant") && typeof message.content === "string";
    })
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
}

export async function POST(req: Request) {
  let body: ChatRequestBody;

  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const openAiKey = process.env.OPENAI_API_KEY;

  if (!openAiKey) {
    return NextResponse.json({ error: "OpenAI API key is not configured" }, { status: 500 });
  }

  const history = normalizeHistory(body.history);
  const userMessage = typeof body.message === "string" ? body.message.trim() : "";

  if (!userMessage) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const conversationId = body.conversationId?.trim() || Date.now().toString();

  const payload = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: userMessage },
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

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const reply = data.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    return NextResponse.json({ error: "OpenAI response was empty" }, { status: 502 });
  }

  const filePath = await ensureIdeasFile(conversationId);
  const timestamp = new Date().toISOString();
  const entry = `## ${timestamp}\n\n### User\n${userMessage}\n\n### Assistant\n${reply}\n\n`;
  await fs.appendFile(filePath, entry, "utf8");

  return NextResponse.json({ conversationId, reply });
}
