import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

export default async function NewWorkspacePage() {
  async function create(formData: FormData) {
    "use server";
    const name = String(formData.get("name") || "My Workspace");
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await supabase.from("workspaces").insert({ name, owner_user_id: null }).select().single();
    if (error) throw new Error(error.message);
    redirect(`/workspace/${data.id}/roadmap`);
  }

  return (
    <form action={create} className="max-w-md space-y-3">
      <input name="name" placeholder="Workspace name" className="border p-2 w-full" />
      <button className="border px-3 py-2">Create</button>
    </form>
  );
}
