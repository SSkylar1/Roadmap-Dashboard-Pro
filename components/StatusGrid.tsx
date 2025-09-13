'use client';
export default function StatusGrid({ status }: { status: any }) {
  return (
    <div style={{marginTop:12}}>
      {status.weeks.map((w: any) => (
        <div key={w.id} style={{marginBottom:16}}>
          <div className="badge">{w.title}</div>
          <ul>
            {w.items.map((it: any) => (
              <li key={it.id}>{it.done ? "✅" : "❌"} <strong>{it.name}</strong> <code>{it.id}</code></li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
