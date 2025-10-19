import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

import { STANDALONE_MODE } from "@/lib/config";
import { getCurrentStandaloneWorkspaceRoadmap } from "@/lib/standalone/roadmaps-store";

export default async function RoadmapPage({ params }: { params: { id: string } }) {
  let roadmap: any | null = null;
  let loadError: string | null = null;

  if (STANDALONE_MODE) {
    roadmap = getCurrentStandaloneWorkspaceRoadmap(params.id);
  } else {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      loadError =
        "Supabase environment variables are missing. Configure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or enable STANDALONE_MODE.";
    } else {
      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
      const { data, error } = await supabase
        .from("roadmaps")
        .select("*")
        .eq("workspace_id", params.id)
        .eq("is_current", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        loadError = error.message;
      } else {
        roadmap = data;
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Roadmap</h1>
        <div className="space-x-2">
          <Link href={`/wizard/concept?workspaceId=${params.id}`} className="border px-3 py-2">Paste/Upload new</Link>
          {roadmap ? (
            <form action={`/api/roadmaps/${roadmap.id}/checks`} method="POST">
              <button className="border px-3 py-2">Re-run checks</button>
            </form>
          ) : null}
        </div>
      </div>
      {loadError ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to load the latest roadmap. {loadError}
        </div>
      ) : !roadmap ? (
        <p>
          {STANDALONE_MODE
            ? "No standalone roadmap snapshot yet. Paste or upload one to get started."
            : "No roadmap yet. Paste one to get started."}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="font-medium">{roadmap.title}</div>
          <pre className="bg-gray-50 p-3 overflow-auto">{JSON.stringify(roadmap.status, null, 2)}</pre>
          {roadmap.status?.problems?.length ? (
            <ul className="list-disc pl-5">
              {roadmap.status.problems.map((p: string, i: number) => <li key={i}>{p}</li>)}
            </ul>
          ) : <p>No problems found.</p>}
        </div>
      )}
    </div>
  );
}
