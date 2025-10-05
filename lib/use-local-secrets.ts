"use client";

import { useEffect, useState } from "react";

import {
  EMPTY_STORE,
  normalizeSecretsForSave,
  type RepoProjectSecrets,
  type RepoSecrets,
  type ResolvedSecrets,
  type SecretsStore,
  createProjectEntry,
  createRepoEntry,
  resolveSecrets,
} from "./secrets";

export { EMPTY_STORE, createProjectEntry, createRepoEntry, normalizeSecretsForSave, resolveSecrets } from "./secrets";
export type {
  RepoProjectSecrets,
  RepoSecrets,
  ResolvedSecrets,
  SecretsStore,
} from "./secrets";

export const LOCAL_SECRETS_EVENT = "rdp:secrets-updated";

let cache: SecretsStore = EMPTY_STORE;
let pending: Promise<SecretsStore> | null = null;
let hasLoaded = false;

function broadcast(store: SecretsStore) {
  cache = store;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<SecretsStore>(LOCAL_SECRETS_EVENT, { detail: store }));
  }
}

async function fetchSecretsFromServer(): Promise<SecretsStore> {
  const response = await fetch("/api/settings", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });

  const payloadRaw = await response
    .json()
    .catch(() => ({}) as { secrets?: SecretsStore; error?: string } | SecretsStore | { error?: string });

  if (!response.ok) {
    const message = (payloadRaw as { error?: string })?.error ?? "Failed to load secrets";
    throw new Error(message);
  }

  const payload = payloadRaw as { secrets?: SecretsStore } | SecretsStore;
  const store = normalizeSecretsForSave("secrets" in payload ? payload.secrets ?? EMPTY_STORE : (payload as SecretsStore));
  return store;
}

export async function loadSecretsFromServer(force = false): Promise<SecretsStore> {
  if (pending) {
    return pending;
  }
  if (hasLoaded && !force) {
    return Promise.resolve(cache);
  }
  pending = fetchSecretsFromServer()
    .then((store) => {
      hasLoaded = true;
      const normalized = normalizeSecretsForSave(store);
      broadcast(normalized);
      return normalized;
    })
    .catch((error) => {
      hasLoaded = false;
      throw error;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function updateSecretsCache(store: SecretsStore) {
  const normalized = normalizeSecretsForSave(store);
  hasLoaded = true;
  broadcast(normalized);
}

export function useLocalSecrets() {
  const [store, setStore] = useState<SecretsStore>(cache);

  useEffect(() => {
    let cancelled = false;
    loadSecretsFromServer().catch((error) => {
      if (!cancelled) {
        console.error("Failed to load secrets", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SecretsStore>).detail;
      setStore(detail ?? cache);
    };
    if (typeof window !== "undefined") {
      window.addEventListener(LOCAL_SECRETS_EVENT, handler as EventListener);
    }
    setStore(cache);
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(LOCAL_SECRETS_EVENT, handler as EventListener);
      }
    };
  }, []);

  return store;
}
