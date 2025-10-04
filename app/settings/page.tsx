"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

import {
  LOCAL_SECRETS_EVENT,
  LOCAL_SECRETS_STORAGE_KEY,
  readLocalSecrets,
} from "@/lib/use-local-secrets";

type SecretsFormState = {
  githubPat: string;
  supabaseReadOnlyUrl: string;
  openaiKey: string;
};

const emptyState: SecretsFormState = {
  githubPat: "",
  supabaseReadOnlyUrl: "",
  openaiKey: "",
};

export default function SettingsPage() {
  const [formState, setFormState] = useState<SecretsFormState>(emptyState);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const parsed = readLocalSecrets() as Partial<SecretsFormState>;
      setFormState((prev) => ({ ...prev, ...parsed }));
    } catch (err) {
      console.error("Failed to load stored secrets", err);
    }
  }, []);

  const hasChanges = useMemo(() => {
    try {
      const stored = window.localStorage.getItem(LOCAL_SECRETS_STORAGE_KEY);
      if (!stored) {
        return Object.values(formState).some(Boolean);
      }
      const parsed = JSON.parse(stored) as SecretsFormState;
      return (
        parsed.githubPat !== formState.githubPat ||
        parsed.supabaseReadOnlyUrl !== formState.supabaseReadOnlyUrl ||
        parsed.openaiKey !== formState.openaiKey
      );
    } catch {
      return Object.values(formState).some(Boolean);
    }
  }, [formState]);

  const handleChange = (field: keyof SecretsFormState) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setFormState((prev) => ({ ...prev, [field]: value }));
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formState),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to save settings");
      }

      window.localStorage.setItem(LOCAL_SECRETS_STORAGE_KEY, JSON.stringify(formState));
      window.dispatchEvent(new Event(LOCAL_SECRETS_EVENT));
      setLastSaved(new Date().toISOString());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unable to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold text-slate-900">Secrets &amp; integrations</h1>
        <p className="max-w-2xl text-sm text-slate-600">
          Store credentials locally while we finish wiring secure storage. These values never leave your browser,
          but the Save button will validate the form and prepare the future sync endpoint.
        </p>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <p className="font-medium text-slate-700">Heads up</p>
          <p>
            Everything you enter here is written to <code>localStorage</code> on this device. Clear your browser
            data to remove them, and re-enter the values on other devices.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <section className="space-y-4">
          <header className="space-y-1">
            <h2 className="text-xl font-medium text-slate-900">GitHub access</h2>
            <p className="text-sm text-slate-600">
              Personal access token with <code>repo</code> scope for committing roadmap artifacts.
            </p>
          </header>
          <div className="space-y-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              GitHub personal access token
              <input
                type="password"
                autoComplete="off"
                value={formState.githubPat}
                onChange={handleChange("githubPat")}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxx"
              />
            </label>
          </div>
        </section>

        <section className="space-y-4">
          <header className="space-y-1">
            <h2 className="text-xl font-medium text-slate-900">Supabase read-only checks</h2>
            <p className="text-sm text-slate-600">
              Endpoint the discovery workflow can call for health checks. We recommend creating a restricted
              function URL.
            </p>
          </header>
          <div className="space-y-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Supabase read-only checks URL
              <input
                type="url"
                autoComplete="off"
                value={formState.supabaseReadOnlyUrl}
                onChange={handleChange("supabaseReadOnlyUrl")}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="https://project.supabase.co/functions/v1/read-only-checks"
              />
            </label>
          </div>
        </section>

        <section className="space-y-4">
          <header className="space-y-1">
            <h2 className="text-xl font-medium text-slate-900">OpenAI integration</h2>
            <p className="text-sm text-slate-600">
              Used for brainstorming chats and roadmap generation. Requires at least <code>gpt-4o-mini</code> access.
            </p>
          </header>
          <div className="space-y-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              OpenAI API key
              <input
                type="password"
                autoComplete="off"
                value={formState.openaiKey}
                onChange={handleChange("openaiKey")}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="sk-..."
              />
            </label>
          </div>
        </section>

        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : lastSaved ? (
          <p className="text-sm text-emerald-600">Saved locally at {new Date(lastSaved).toLocaleTimeString()}.</p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSaving || !hasChanges}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {isSaving ? "Saving" : "Save secrets"}
          </button>
          {!hasChanges && !isSaving ? (
            <span className="text-xs text-slate-500">No changes to save.</span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
