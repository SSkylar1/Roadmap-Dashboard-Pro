'use client';
import React, { useEffect, useState } from 'react';

export default function Settings({ params }: { params: { owner: string; repo: string } }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await fetch(`/api/settings?owner=${params.owner}&repo=${params.repo}`);
      const j = await r.json();
      setLoading(false);
      setText(j.content || '');
    })();
  }, [params.owner, params.repo]);

  const save = async () => {
    setMessage('');
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: params.owner, repo: params.repo, branch: 'chore/update-rc', content: text })
    });
    const j = await r.json();
    setMessage(j.url ? `PR opened: ${j.url}` : (j.error || 'Unknown error'));
  };

  return (
    <div className="card">
      <h2>Settings (.roadmaprc.json)</h2>
      {loading ? <p className="hint">Loading…</p> : (
        <>
          <textarea value={text} onChange={e=>setText(e.target.value)} />
          <div style={{height:10}} />
          <button onClick={save}>Open PR with changes</button>
          {message && <p className="hint" style={{marginTop:8}}>{message}</p>}
        </>
      )}
    </div>
  );
}
