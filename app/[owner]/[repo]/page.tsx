import { fetchRepoFile } from "@/lib/github";
import StatusGrid from "@/components/StatusGrid";

export default async function Project({ params }: { params: { owner: string; repo: string } }) {
  const token = await import('@/lib/token').then(m => m.getTokenForRepo(params.owner, params.repo));
  const raw = await fetchRepoFile({ owner: params.owner, repo: params.repo, path: "docs/roadmap-status.json", token });
  const status = raw ? JSON.parse(raw) : null;

  return (
    <div className="grid">
      {!status ? (
        <div className="card">
          <h2>{params.owner}/{params.repo}</h2>
          <p className="hint">No status yet. Ensure workflows wrote docs/roadmap-status.json.</p>
        </div>
      ) : (
        <div className="card">
          <h2>{params.owner}/{params.repo}</h2>
          <div className="hint">Generated: {status.generated_at} • Env: {status.env}</div>
          <StatusGrid status={status} />
          <div style={{height:10}} />
          <a href={`/${params.owner}/${params.repo}/settings`}><button>Open Settings</button></a>
        </div>
      )}
    </div>
  );
}
