import { NextResponse } from "next/server";

import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";
import { getFileRaw, putFile } from "@/lib/github";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

type PromoteRequestBody = {
  conversationId?: string;
  messages?: ClientMessage[];
  owner?: string;
  repo?: string;
  branch?: string;
  project?: string | null;
  openAsPr?: boolean;
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

function appendIdeaEntry(
  existing: string | null,
  transcript: string,
  timestamp: string,
  conversationId?: string | null,
) {
  const headerParts = [
    `## Session promoted on ${timestamp}`,
    conversationId ? `Session ID: ${conversationId}` : undefined,
    "",
  ].filter(Boolean);

  const base = existing ? `${existing.trimEnd()}\n\n` : "# Idea Log\n\n";
  const entry = `${headerParts.join("\n")}\n${transcript.trim()}\n`;
  return `${base}${entry.trimEnd()}\n\n`;
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

  const owner = body.owner?.trim();
  const repo = body.repo?.trim();
  const branch = body.branch?.trim() || "main";
  const project = body.project?.trim();
  const openAsPr = Boolean(body.openAsPr);

  if (!owner || !repo) {
    return NextResponse.json({ error: "Missing owner or repo" }, { status: 400 });
  }

  const projectKey = normalizeProjectKey(project);
  const basePath = "docs/idea-log.md";
  const targetPath = projectAwarePath(basePath, projectKey);
  const label = describeProjectFile(basePath, projectKey);

  const transcript = formatTranscript(messages);
  const conversationId = body.conversationId?.trim();
  const timestamp = new Date().toISOString();

  const token = req.headers.get("x-github-pat") ?? undefined;

  let existing: string | null = null;
  try {
    existing = await getFileRaw(owner, repo, targetPath, branch, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to load existing idea log", detail: message }, { status: 500 });
  }

  const content = appendIdeaEntry(existing, transcript, timestamp, conversationId);
  const commitMessage = conversationId
    ? `Add idea log entry for ${conversationId}`
    : "Add idea log entry";

  try {
    const result = await putFile(owner, repo, targetPath, content, branch, commitMessage, {
      token,
      asPR: openAsPr,
    });
    const resolvedBranch = typeof result.branch === "string" ? result.branch : branch;
    const pullRequest = result.pullRequest;
    return NextResponse.json({
      ok: true,
      path: basePath,
      label,
      owner,
      repo,
      branch,
      promotedBranch: resolvedBranch,
      project: projectKey ?? null,
      prUrl: pullRequest?.html_url ?? pullRequest?.url,
      pullRequestNumber: pullRequest?.number,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to write idea log", detail: message }, { status: 500 });
  }
}
