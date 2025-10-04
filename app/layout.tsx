import "./globals.css";
import Link from "next/link";
import React from "react";

export const metadata = {
  title: "Roadmap Dashboard Pro",
  description: "Continuous context dashboard for roadmap-kit projects (GitHub App ready)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="tw-flex tw-flex-col tw-gap-4 tw-mb-6">
            <div className="tw-flex tw-flex-wrap tw-items-start tw-justify-between tw-gap-4">
              <div className="tw-space-y-2">
                <h1>🚀 Roadmap Dashboard Pro</h1>
                <div className="hint">Onboard repos, view status, edit rc, and verify infra — safely.</div>
              </div>
              <nav className="tw-inline-flex tw-flex-wrap tw-gap-2">
                <Link
                  href="/"
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-sm tw-font-medium tw-text-slate-300 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-700 hover:tw-text-slate-100"
                >
                  <span>Dashboard</span>
                </Link>
                <Link
                  href="/wizard"
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-sm tw-font-medium tw-text-slate-300 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-700 hover:tw-text-slate-100"
                >
                  <span>Add New Project</span>
                </Link>
                <Link
                  href="/settings"
                  className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-px-3 tw-py-1 tw-text-sm tw-font-medium tw-text-slate-300 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-700 hover:tw-text-slate-100"
                >
                  <span>Settings</span>
                </Link>
              </nav>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
