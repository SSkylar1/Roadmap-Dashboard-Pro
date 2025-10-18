import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

export default async function RoadmapPage({ params }: { params: { id: string } }) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: roadmap } = await supabase
    .from("roadmaps")
    .select("*")
    .eq("workspace_id", params.id)
    .eq("is_current", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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
      {!roadmap ? (
        <p>No roadmap yet. Paste one to get started.</p>
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
