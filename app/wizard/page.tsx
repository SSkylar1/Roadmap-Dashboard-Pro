import Link from "next/link";

const ENTRY_POINTS = [
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

export default function WizardLandingPage() {
  return (
    <section className="tw-space-y-10">
      <div className="tw-space-y-3">
        <span className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-xs tw-font-medium tw-uppercase tw-tracking-wide tw-text-slate-300">
          Product Wizard
        </span>
        <h1 className="tw-text-3xl tw-font-bold tw-leading-tight tw-text-slate-100">
          Choose your starting point
        </h1>
        <p className="tw-text-lg tw-leading-relaxed tw-text-slate-300">
          Match the wizard to your current milestone so the right roadmap, automations, and integrations spin up instantly.
        </p>
      </div>

      <div className="tw-grid tw-gap-6 md:tw-grid-cols-2">
        {ENTRY_POINTS.map((entry) => (
          <Link
            key={entry.slug}
            href={`/wizard/${entry.slug}`}
            className="tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-8 tw-flex tw-flex-col tw-gap-6 tw-h-full tw-transition tw-duration-200 tw-ease-out tw-transform hover:tw-border-slate-700 hover:tw-shadow-xl hover:tw-translate-y-[-4px]"
          >
            <div className="tw-inline-flex tw-items-center tw-gap-2 tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-300">
              <span className="tw-inline-flex tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-[0.7rem] tw-font-semibold tw-text-slate-100">
                {entry.label}
              </span>
              <span className="tw-text-slate-400">Entry Point</span>
            </div>

            <div className="tw-space-y-2">
              <h2 className="tw-text-2xl tw-font-semibold tw-leading-snug tw-text-slate-100">
                {entry.title}
              </h2>
              <p className="tw-text-sm tw-leading-relaxed tw-text-slate-300">{entry.description}</p>
            </div>

            <ul className="tw-space-y-2 tw-text-sm tw-text-slate-300 tw-list-disc tw-pl-5">
              {entry.bullets.map((bullet) => (
                <li key={bullet} className="tw-leading-relaxed">
                  {bullet}
                </li>
              ))}
            </ul>

            <div className="tw-inline-flex tw-items-center tw-gap-2 tw-text-sm tw-font-medium tw-text-slate-100">
              <span>Open workflow</span>
              <span aria-hidden="true">→</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
