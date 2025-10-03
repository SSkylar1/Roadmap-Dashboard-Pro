import Link from "next/link";
 
import { WIZARD_ENTRY_POINTS } from "@/lib/wizard-entry-points";

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
        {WIZARD_ENTRY_POINTS.map((entry) => (
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
