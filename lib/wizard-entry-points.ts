export type WizardEntryTool = {
  href: string;
  label: string;
  description?: string;
};

export type WizardEntryPoint = {
  slug: string;
  label: string;
  title: string;
  description: string;
  bullets: readonly string[];
  tools?: readonly WizardEntryTool[];
};

export const WIZARD_ENTRY_POINTS: readonly WizardEntryPoint[] = [
  {
    slug: "new-idea",
    label: "Ideate",
    title: "New Idea Brainstorming",
    description:
      "Open a persistent AI ideation hub that captures every spark, note, and inspiration so nothing gets lost between sessions.",
    bullets: [
      "Start a project-linked conversation that keeps your brainstorming history in sync.",
      "Clip research, voice notes, and quick sketches into a living idea vault.",
      "Upgrade the flow into a roadmap whenever you are ready to commit.",
    ],
    tools: [
      {
        href: "/wizard/brainstorm",
        label: "Launch idea workspace",
        description: "Open the AI chat that logs every turn and can be promoted into docs/idea-log.md.",
      },
    ],
  },
  {
    slug: "concept",
    label: "Design",
    title: "Firm Concept, Missing Roadmap",
    description:
      "Transform your concept brief into a structured roadmap with generated files, integrations, and connection points.",
    bullets: [
      "Import an existing AI chat or upload your concept write-up for instant context.",
      "Co-create an actionable roadmap and scaffold repo-ready artifacts in one click.",
      "Wire up Supabase, secrets, and GitHub so your execution stack is ready to ship.",
    ],
    tools: [
      {
        href: "/wizard/concept/workspace",
        label: "Open roadmap drafting workspace",
        description: "Paste your brief or upload a file, generate docs/roadmap.yml, and commit it to the repo.",
      },
    ],
  },
  {
    slug: "roadmap-ready",
    label: "Launch",
    title: "Roadmap Ready, Pre-Build",
    description:
      "Drop in an existing roadmap and let the wizard provision your repo, automations, and context packs automatically.",
    bullets: [
      "Upload roadmap docs and sync the structure into docs/roadmap.yml.",
      "Generate GTM, tech stack, and infra snapshots that stay aligned with the plan.",
      "Push the new workspace to GitHub with secrets and integrations configured.",
    ],
    tools: [
      {
        href: "/wizard/roadmap/workspace",
        label: "Launch provisioning workspace",
        description:
          "Upload an existing roadmap.yml, validate it, and scaffold infra-facts, tech stack, and roadmap workflow files.",
      },
    ],
  },
  {
    slug: "mid-build",
    label: "Scale",
    title: "Mid-Project Build",
    description:
      "Layer discovery mode on top of your active repo so AI copilots see progress, regressions, and the next best action.",
    bullets: [
      "Ingest repo history, Supabase schema, and roadmap status into a unified context pack.",
      "Surface off-roadmap work automatically so nothing gets lost in the shuffle.",
      "Hand the full context to your AI teammate or keep coding with richer feedback.",
    ],
    tools: [
      {
        href: "/wizard/midproject",
        label: "Launch mid-project sync",
        description: "Run status + discover workflows and preview backlog discoveries before opening the dashboard.",
      },
    ],
  },
] as const;
