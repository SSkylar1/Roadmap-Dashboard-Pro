import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { STANDALONE_MODE } from "@/lib/config";

export default async function NewWorkspacePage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseConfigured = Boolean(supabaseUrl && supabaseServiceRoleKey);

  async function create(formData: FormData) {
    "use server";
    const name = String(formData.get("name") || "My Workspace");
    if (STANDALONE_MODE) {
      const slug = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const workspaceId = slug || randomUUID();
      redirect(`/workspace/${workspaceId}/roadmap`);
    }

    if (!supabaseConfigured) {
      throw new Error("Supabase is not configured.");
    }

    const supabase = createClient(supabaseUrl!, supabaseServiceRoleKey!);
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ name, owner_user_id: null })
      .select()
      .single();
    if (error) throw new Error(error.message);
    redirect(`/workspace/${data.id}/roadmap`);
  }

  if (!supabaseConfigured && !STANDALONE_MODE) {
    return (
      <div className="max-w-md space-y-3 rounded border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
        <p className="font-medium">Supabase is not configured.</p>
        <p>
          Provide <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> in your environment or set{" "}
          <code>STANDALONE_MODE=true</code> to use the in-memory workflow.
        </p>
      </div>
    );
  }

  return (
    <form action={create} className="max-w-md space-y-3">
      <input name="name" placeholder="Workspace name" className="border p-2 w-full" />
      {STANDALONE_MODE ? (
        <p className="text-sm text-gray-600">Standalone mode creates an in-memory workspace for this session.</p>
      ) : null}
      <button className="border px-3 py-2">Create</button>
    </form>
  );
}
