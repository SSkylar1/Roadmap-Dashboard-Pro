import Link from "next/link";
import { notFound } from "next/navigation";

const STAGES = {
  "new-idea": {
    label: "Ideation",
    title: "New Idea Brainstorming",
    description:
      "Capture and expand every spark with a persistent AI workspace that keeps your ideas tethered to future execution.",
    cta: {
      eyebrow: "Live AI workspace",
      title: "Jump into the brainstorming chat",
      description:
        "Spin up the connected ideation thread so every idea, insight, and follow-up question stays linked to this project.",
      action: {
        href: "/wizard/brainstorm",
        label: "Launch idea workspace",
      },
      note: "Opens the interactive chat where each turn is saved to /tmp/ideas and can be promoted into docs/idea-log.md.",
    },
    sections: [
      {
        id: "canvas",
        title: "Spin up your idea canvas",
        summary:
          "Start a connected chat workspace and define the problem, audience, and success signals before you rush into solutions.",
        checklist: [
          {
            title: "Create a linked AI thread",
            detail:
              "Launch a project chat that stores history and can be promoted into a roadmap when you are ready to commit.",
          },
          {
            title: "Map the opportunity",
            detail:
              "Outline core jobs-to-be-done, constraints, and differentiators. Drop links, voice notes, or sketches directly into the canvas.",
          },
          {
            title: "Mark open questions",
            detail:
              "Flag unknowns for future discovery so the roadmap wizard can track research tasks alongside build work.",
          },
        ],
      },
      {
        id: "transition",
        title: "Get roadmap-ready",
        summary:
          "When the concept firms up, promote the session into a draft roadmap without losing any of the conversational context.",
        checklist: [
          {
            title: "Highlight must-have outcomes",
            detail: "Convert promising notes into roadmap epics with draft success metrics.",
          },
          {
            title: "Attach reference material",
            detail: "Upload PDFs, competitor teardowns, or market research so execution always stays grounded in your insight.",
          },
          {
            title: "Review with collaborators",
            detail: "Share the board or export a brief for feedback before moving into the build planning flow.",
          },
        ],
      },
    ],
    resources: [
      { label: "Back to wizard", href: "/wizard" },
      { label: "Launch idea workspace", href: "/wizard/brainstorm" },
    ],
  },
  concept: {
    label: "Roadmap Drafting",
    title: "Firm Concept, Missing Roadmap",
    description:
      "Turn your concept brief into an actionable roadmap, complete with generated project files, integrations, and automation hooks.",
    cta: {
      eyebrow: "Roadmap workspace",
      title: "Draft docs/roadmap.yml from your brief",
      description:
        "Open the guided flow to paste concept notes, upload supporting files, and generate a YAML roadmap before committing it to your repo.",
      action: {
        href: "/wizard/concept/workspace",
        label: "Open roadmap drafting workspace",
      },
      note: "Launches the upload + AI generation experience with repo commit controls.",
    },
    sections: [
      {
        id: "ingest",
        title: "Import and align context",
        summary:
          "Upload your concept doc or pull in an existing AI conversation so the wizard understands scope, goals, and guardrails.",
        checklist: [
          {
            title: "Link supporting chats",
            detail: "Attach brainstorming threads so the assistant can reference prior thinking during roadmap generation.",
          },
          {
            title: "Clarify constraints",
            detail: "Call out timelines, team capacity, and tech stack preferences so the plan reflects reality.",
          },
          {
            title: "Set success metrics",
            detail: "Define the signals that tell you the launch worked — adoption, revenue, activation, or retention goals.",
          },
        ],
      },
      {
        id: "scaffold",
        title: "Generate the execution scaffold",
        summary:
          "Translate the concept into docs/roadmap.yml, docs/gtm-plan.md, and integration-ready placeholders with one click.",
        checklist: [
          {
            title: "Draft roadmap milestones",
            detail: "Let the wizard propose weeks, owners, and deliverables that you can edit before publishing.",
          },
          {
            title: "Configure integrations",
            detail: "Paste Supabase and GitHub secrets so automated status checks can run from day one.",
          },
          {
            title: "Push to your repo",
            detail: "Export the scaffold into your workspace and open a PR for teammates to review.",
          },
        ],
      },
    ],
    resources: [
      { label: "Back to wizard", href: "/wizard" },
      { label: "Open roadmap drafting workspace", href: "/wizard/concept/workspace" },
    ],
  },
  "roadmap-ready": {
    label: "Workspace Provisioning",
    title: "Roadmap Ready, Pre-Build",
    description:
      "Drop in your final roadmap and let the wizard generate the repo automations, context packs, and status surfaces you will need for build.",
    cta: {
      eyebrow: "Provisioning workspace",
      title: "Import roadmap.yml and scaffold automations",
      description:
        "Upload your existing docs/roadmap.yml, validate it, and generate infra facts, tech stack, and roadmap workflow files in one flow.",
      action: {
        href: "/wizard/roadmap/workspace",
        label: "Launch provisioning workspace",
      },
      note: "Commits docs/roadmap.yml along with docs/infra-facts.md, docs/tech-stack.yml, and .github/workflows/roadmap.yml if they are missing.",
    },
    sections: [
      {
        id: "sync",
        title: "Sync roadmap artifacts",
        summary:
          "Upload or paste your roadmap so docs/roadmap.yml, docs/tech-stack.yml, and docs/gtm-plan.md reflect the latest thinking.",
        checklist: [
          {
            title: "Validate milestones",
            detail: "Confirm epics, owners, and dependencies are tagged so progress tracking stays precise.",
          },
          {
            title: "Align GTM + build",
            detail: "Map GTM beats to engineering sprints so launches feel coordinated from the start.",
          },
          {
            title: "Generate summary context",
            detail: "Publish docs/summary.txt so any AI agent can ramp instantly.",
          },
        ],
      },
      {
        id: "integrate",
        title: "Wire automations",
        summary:
          "Provision GitHub workflows, Supabase access, and context feeds that keep roadmap status live once development begins.",
        checklist: [
          {
            title: "Connect GitHub",
            detail: "Authorize the wizard to push scaffolding commits or open pull requests in your repo.",
          },
          {
            title: "Link Supabase",
            detail: "Share read-only credentials so discovery runs can analyze schema and row-level security.",
          },
          {
            title: "Schedule status reports",
            detail: "Decide how often docs/roadmap-status.json should refresh and who receives updates.",
          },
        ],
      },
    ],
    resources: [
      { label: "Back to wizard", href: "/wizard" },
      { label: "Launch provisioning workspace", href: "/wizard/roadmap/workspace" },
      { label: "Provision automations", href: "/api/setup" },
    ],
  },
  "mid-build": {
    label: "Discovery Mode",
    title: "Mid-Project Build",
    description:
      "Overlay discovery mode on your live project so AI copilots see what changed, what shipped, and what needs attention next.",
    cta: {
      eyebrow: "Current state sync",
      title: "Refresh roadmap status before diving in",
      description:
        "Launch the mid-project sync workspace to run /api/run and /api/discover, then preview the updated status grid and backlog list.",
      action: {
        href: "/wizard/midproject",
        label: "Launch mid-project sync",
      },
      note: "Generates docs/roadmap-status.json, docs/project-plan.md, and docs/backlog-discovered.yml so the dashboard is already current.",
    },
    sections: [
      {
        id: "ingest",
        title: "Load current context",
        summary:
          "Pull the latest code, Supabase schema, and roadmap status so the wizard reflects reality before any new suggestions drop.",
        checklist: [
          {
            title: "Scan the repo",
            detail: "Index commits, open PRs, and drift from docs/roadmap.yml to understand real progress.",
          },
          {
            title: "Run discovery checks",
            detail: "Use the discover API to surface off-roadmap work or regressions that need triage.",
          },
          {
            title: "Regenerate context pack",
            detail: "Publish a fresh bundle for your AI teammates so they jump in fully briefed.",
          },
        ],
      },
      {
        id: "plan",
        title: "Shape the next sprint",
        summary:
          "Blend roadmap goals with discovered insights to keep the build plan accurate and resilient.",
        checklist: [
          {
            title: "Prioritize surfaced work",
            detail: "Accept or reject the discover list so roadmap status stays trustworthy.",
          },
          {
            title: "Update success metrics",
            detail: "Refine targets based on what you have learned mid-flight.",
          },
          {
            title: "Loop in your AI partner",
            detail: "Assign coding tasks or ask for implementation help backed by the refreshed context pack.",
          },
        ],
      },
    ],
    resources: [
      { label: "Back to wizard", href: "/wizard" },
      { label: "Launch mid-project sync", href: "/wizard/midproject" },
      { label: "Trigger discover run", href: "/api/discover" },
    ],
  },
} as const;

type StageKey = keyof typeof STAGES;

type WizardStatePageProps = {
  params: { state: string };
};

export default function WizardStatePage({ params }: WizardStatePageProps) {
  const stageKey = params.state as StageKey;
  const stage = STAGES[stageKey];

  if (!stage) {
    notFound();
  }

  return (
    <section className="tw-space-y-10">
      <div className="tw-space-y-3">
        <Link
          href="/wizard"
          className="tw-inline-flex tw-items-center tw-gap-2 tw-text-sm tw-text-slate-300 tw-transition tw-duration-200 tw-ease-out hover:tw-text-slate-100"
        >
          <span aria-hidden="true">←</span>
          <span>Back to wizard</span>
        </Link>
        <span className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-300">
          {stage.label}
        </span>
        <h1 className="tw-text-3xl tw-font-bold tw-leading-tight tw-text-slate-100">{stage.title}</h1>
        <p className="tw-text-lg tw-leading-relaxed tw-text-slate-300">{stage.description}</p>
      </div>

      {stage.cta && (
        <div className="tw-rounded-3xl tw-border tw-border-blue-500/40 tw-bg-blue-500/10 tw-p-6 tw-flex tw-flex-col tw-gap-4">
          <div className="tw-space-y-2">
            <span className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-blue-500/40 tw-bg-blue-500/10 tw-px-3 tw-py-1 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-blue-200">
              {stage.cta.eyebrow}
            </span>
            <h2 className="tw-text-2xl tw-font-semibold tw-text-blue-100">{stage.cta.title}</h2>
            <p className="tw-text-sm tw-leading-relaxed tw-text-blue-100/80">{stage.cta.description}</p>
          </div>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
            <Link
              href={stage.cta.action.href}
              className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-bg-blue-500 tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-text-blue-50 tw-shadow-lg tw-shadow-blue-500/30 tw-transition tw-duration-200 tw-ease-out hover:tw-bg-blue-400"
            >
              <span>{stage.cta.action.label}</span>
              <span aria-hidden="true">→</span>
            </Link>
            <p className="tw-text-xs tw-text-blue-100/70">{stage.cta.note}</p>
          </div>
        </div>
      )}

      <div className="tw-grid tw-gap-6 md:tw-grid-cols-2">
        {stage.sections.map((section) => (
          <div
            key={section.id}
            className="tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-6 tw-flex tw-flex-col tw-gap-4"
          >
            <div className="tw-space-y-2">
              <h2 className="tw-text-xl tw-font-semibold tw-leading-snug tw-text-slate-100">{section.title}</h2>
              <p className="tw-text-sm tw-leading-relaxed tw-text-slate-300">{section.summary}</p>
            </div>
            <ul className="tw-space-y-2 tw-text-sm tw-text-slate-300 tw-list-disc tw-pl-5">
              {section.checklist.map((item) => (
                <li key={item.title} className="tw-leading-relaxed">
                  <span className="tw-font-medium tw-text-slate-100 tw-block">{item.title}</span>
                  <span className="tw-text-slate-300">{item.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {stage.resources.length > 0 && (
        <div className="tw-flex tw-flex-wrap tw-gap-3">
          {stage.resources.map((resource) => (
            <Link
              key={resource.label}
              href={resource.href}
              className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-sm tw-font-medium tw-text-slate-300 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-700 hover:tw-text-slate-100"
            >
              <span>{resource.label}</span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
