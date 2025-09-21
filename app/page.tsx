import { Suspense } from "react";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

function PageFallback() {
  return (
    <main className="dashboard">
      <div className="card muted">Loading dashboard…</div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <HomeClient />
    </Suspense>
  );
}
