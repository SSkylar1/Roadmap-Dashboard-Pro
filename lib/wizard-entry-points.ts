export type WizardEntryPoint = {
  slug: string;
  label: string;
  title: string;
  description: string;
  bullets: readonly string[];
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
  },
] as const;
