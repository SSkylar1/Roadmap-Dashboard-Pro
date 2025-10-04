import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

type PromoteRequestBody = {
  conversationId?: string;
  messages?: ClientMessage[];
};

function normalizeMessages(messages?: ClientMessage[]): ClientMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
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

function formatTranscript(messages: ClientMessage[]): string {
  return messages
    .map((message, index) => {
      const speaker = message.role === "user" ? "Founder" : "AI Partner";
      const formattedContent = message.content.replace(/\n/g, "\n  ");
      return `${index + 1}. **${speaker}:** ${formattedContent}`;
    })
    .join("\n");
}

export async function POST(req: Request) {
  let body: PromoteRequestBody;

  try {
    body = await req.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = normalizeMessages(body.messages);

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages to export" }, { status: 400 });
  }

  const conversationId = body.conversationId?.trim();
  const timestamp = new Date().toISOString();

  const docsDir = path.join(process.cwd(), "docs");
  await fs.mkdir(docsDir, { recursive: true });
  const ideaLogPath = path.join(docsDir, "idea-log.md");

  let content = "";
  try {
    await fs.access(ideaLogPath);
  } catch {
    content += "# Idea Log\n\n";
  }

  const sessionHeaderParts = [
    `## Session promoted on ${timestamp}`,
    conversationId ? `Session ID: ${conversationId}` : undefined,
    "",
  ].filter(Boolean);

  const transcript = formatTranscript(messages);

  content += `${sessionHeaderParts.join("\n")}\n${transcript}\n\n`;

  await fs.appendFile(ideaLogPath, content, "utf8");

  return NextResponse.json({ ok: true, path: "docs/idea-log.md" });
}
