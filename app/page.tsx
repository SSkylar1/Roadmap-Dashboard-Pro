export default function Home() {
  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Onboarding Wizard</h2>
        <p className="hint">Connect a repo and open a setup PR.</p>
        <a href="/new"><button>Start Wizard</button></a>
      </div>
      <div className="card">
        <h2>Project Status</h2>
        <p className="hint">Open a status page for an existing repo.</p>
        <code>/owner/repo</code>
      </div>
    </div>
  );
}
