"use client";

import { useEffect, useState } from "react";

export type LocalSecrets = {
  githubPat?: string;
  supabaseReadOnlyUrl?: string;
  openaiKey?: string;
};

export const LOCAL_SECRETS_STORAGE_KEY = "rdp.settings.secrets";
export const LOCAL_SECRETS_EVENT = "rdp:secrets-updated";

function parseSecrets(raw: string | null): LocalSecrets {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const { githubPat, supabaseReadOnlyUrl, openaiKey } = parsed as LocalSecrets;
      return {
        ...(typeof githubPat === "string" && githubPat.trim() ? { githubPat: githubPat.trim() } : {}),
        ...(typeof supabaseReadOnlyUrl === "string" && supabaseReadOnlyUrl.trim()
          ? { supabaseReadOnlyUrl: supabaseReadOnlyUrl.trim() }
          : {}),
        ...(typeof openaiKey === "string" && openaiKey.trim() ? { openaiKey: openaiKey.trim() } : {}),
      };
    }
  } catch (error) {
    console.warn("Failed to parse stored secrets", error);
  }
  return {};
}

export function readLocalSecrets(): LocalSecrets {
  if (typeof window === "undefined") {
    return {};
  }
  const raw = window.localStorage.getItem(LOCAL_SECRETS_STORAGE_KEY);
  return parseSecrets(raw);
}

export function useLocalSecrets() {
  const [secrets, setSecrets] = useState<LocalSecrets>(() => readLocalSecrets());

  useEffect(() => {
    function refresh() {
      setSecrets(readLocalSecrets());
    }

    window.addEventListener("storage", refresh);
    window.addEventListener(LOCAL_SECRETS_EVENT, refresh);

    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(LOCAL_SECRETS_EVENT, refresh);
    };
  }, []);

  return secrets;
}
