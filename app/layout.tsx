import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Roadmap Dashboard Pro',
  description: 'Continuous context dashboard for roadmap-kit projects (GitHub App ready)'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <h1>🚀 Roadmap Dashboard Pro</h1>
          <div className="hint">Onboard repos, view status, edit rc, and verify infra — safely.</div>
          <div style={{height:10}} />
          {children}
        </div>
      </body>
    </html>
  );
}
