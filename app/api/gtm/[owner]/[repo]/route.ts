import { NextRequest, NextResponse } from "next/server";

import { getFileRaw, putFile } from "@/lib/github";
import { describeProjectFile, normalizeProjectKey, projectAwarePath } from "@/lib/project-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GTM_TEMPLATE = [
  "# Go-To-Market Plan",
  "",
  "## Market",
  "- Target audience:",
  "- Problem we solve:",
  "- Key insights:",
  "",
  "## Positioning",
  "- Value proposition:",
  "- Differentiators:",
  "- Competitive context:",
  "",
  "## Channels",
  "- Primary:",
  "- Secondary:",
  "- Enablement needs:",
  "",
  "## Launch Timeline",
  "- Week 0: Internal enablement",
  "- Week 1: Beta/early access",
  "- Week 2: Public launch",
  "- Follow-up:",
  "",
  "## Pricing",
  "- Model:",
  "- Tiers:",
  "- Promotions/incentives:",
  "",
  "## Metrics",
  "- Activation:",
  "- Engagement:",
  "- Revenue:",
  "- Retention:",
  "",
  "## Owners",
  "- Product:",
  "- Marketing:",
  "- Sales/CS:",
  "",
  "## Next Steps",
  "- [ ] Align stakeholders",
  "- [ ] Publish launch checklist",
  "- [ ] Instrument analytics dashboards",
  "",
].join("\n");

type RouteParams = { params: { owner: string; repo: string } };

type PlanResponse = { content: string };

type CommitResponse = { ok: true; content: string; created: boolean };

type CommitPayload = {
  branch?: string;
  content?: string;
  project?: string;
};

function normalizeBranch(value: unknown) {
  if (typeof value !== "string") return "main";
  const trimmed = value.trim();
  return trimmed ? trimmed : "main";
}

export async function GET(req: NextRequest, context: RouteParams) {
  const { owner, repo } = context.params;
  try {
    const url = new URL(req.url);
    const branch = url.searchParams.get("branch") || undefined;
    const projectKey = normalizeProjectKey(url.searchParams.get("project"));
    const token = req.headers.get("x-github-pat")?.trim() || undefined;
    const path = projectAwarePath("docs/gtm-plan.md", projectKey);
    const raw = await getFileRaw(owner, repo, path, branch, token);
    if (raw === null) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const response: PlanResponse = { content: raw };
    return NextResponse.json(response);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to load GTM plan" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, context: RouteParams) {
  const { owner, repo } = context.params;
  let payload: CommitPayload;
  try {
    payload = (await req.json()) as CommitPayload;
  } catch {
    payload = {};
  }

  const branch = normalizeBranch(payload?.branch);
  const providedContent = typeof payload?.content === "string" ? payload.content : undefined;
  const projectKey = normalizeProjectKey(payload?.project);

  if (providedContent !== undefined && !providedContent.trim()) {
    return NextResponse.json({ error: "GTM plan content cannot be empty" }, { status: 400 });
  }

  const finalContent = providedContent ?? GTM_TEMPLATE;

  try {
    const token = req.headers.get("x-github-pat")?.trim() || undefined;
    const path = projectAwarePath("docs/gtm-plan.md", projectKey);
    const existing = await getFileRaw(owner, repo, path, branch, token);
    const label = describeProjectFile("docs/gtm-plan.md", projectKey);
    const message = existing === null
      ? `feat(gtm): add ${label}`
      : `chore(gtm): update ${label}`;

    await putFile(owner, repo, path, finalContent, branch, message, token);

    const response: CommitResponse = { ok: true, content: finalContent, created: existing === null };
    return NextResponse.json(response);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save GTM plan" },
      { status: 500 },
    );
  }
}
