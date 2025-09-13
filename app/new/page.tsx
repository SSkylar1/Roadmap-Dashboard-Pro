'use client';
import React, { useState } from 'react';

export default function Wizard() {
  const [owner, setOwner] = useState('acme');
  const [repo, setRepo] = useState('roadmap-kit-starter');
  const [branch, setBranch] = useState('chore/roadmap-setup');
  const [readOnlyUrl, setReadOnlyUrl] = useState('https://<ref>.functions.supabase.co/read_only_checks');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const submit = async () => {
    setLoading(true);
    setResult(null);
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner, repo, branch, readOnlyUrl })
    });
    const j = await r.json();
    setLoading(false);
    setResult(j);
  };

  return (
    <div className="card">
      <h2>Onboarding Wizard</h2>
      <div className="form-row">
        <div><label>GitHub Owner</label><input value={owner} onChange={e=>setOwner(e.target.value)} /></div>
        <div><label>Repository</label><input value={repo} onChange={e=>setRepo(e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div><label>Branch name for PR</label><input value={branch} onChange={e=>setBranch(e.target.value)} /></div>
        <div><label>READ_ONLY_CHECKS_URL</label><input value={readOnlyUrl} onChange={e=>setReadOnlyUrl(e.target.value)} /></div>
      </div>
      <div style={{height:12}} />
      <button onClick={submit} disabled={loading}>{loading ? 'Creating PR…' : 'Create Setup PR'}</button>
      {result && (
        <div style={{marginTop:12}}>
          {result.url ? <a href={result.url} target="_blank" rel="noreferrer">Open PR</a> : <pre>{JSON.stringify(result, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}
