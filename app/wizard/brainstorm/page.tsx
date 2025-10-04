"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  conversationId: string;
  reply: string;
};

type ErrorState = {
  title: string;
  detail?: string;
};

export default function BrainstormPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [promoteMessage, setPromoteMessage] = useState<string | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const hasMessages = messages.length > 0;

  const placeholder = useMemo(
    () =>
      "Describe the spark you want to explore, customer pain points, or constraints. The ideation partner will help you expand it.",
    [],
  );

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPromoteMessage(null);

    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    const pendingHistory = messages;
    const payload = {
      conversationId,
      history: pendingHistory,
      message: trimmed,
    };

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch("/api/brainstorm/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const title = typeof detail.error === "string" ? detail.error : "We could not reach OpenAI.";
        const info = typeof detail.detail === "string" ? detail.detail : undefined;
        setError({ title, detail: info });
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      const data = (await response.json()) as ChatResponse;
      setConversationId(data.conversationId);
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError({ title: "Something went wrong sending your idea.", detail: err instanceof Error ? err.message : undefined });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsSending(false);
    }
  }

  async function handlePromote() {
    if (!hasMessages) {
      return;
    }

    setIsPromoting(true);
    setPromoteMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/brainstorm/promote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ conversationId, messages }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const title = typeof detail.error === "string" ? detail.error : "Failed to promote idea to project.";
        const info = typeof detail.detail === "string" ? detail.detail : undefined;
        setError({ title, detail: info });
        return;
      }

      setPromoteMessage("Idea log exported to docs/idea-log.md. You can now turn this into a roadmap.");
    } catch (err) {
      setError({ title: "Promotion failed", detail: err instanceof Error ? err.message : undefined });
    } finally {
      setIsPromoting(false);
    }
  }

  return (
    <section className="tw-space-y-8">
      <div className="tw-space-y-3">
        <Link
          href="/wizard/new-idea"
          className="tw-inline-flex tw-items-center tw-gap-2 tw-text-sm tw-text-slate-300 tw-transition tw-duration-200 tw-ease-out hover:tw-text-slate-100"
        >
          <span aria-hidden="true">←</span>
          <span>Back to ideation playbook</span>
        </Link>
        <h1 className="tw-text-3xl tw-font-bold tw-leading-tight tw-text-slate-100">Idea Workspace</h1>
        <p className="tw-text-lg tw-leading-relaxed tw-text-slate-300">
          Capture every spark in a persistent chat, let AI riff with you, and convert the best ideas into roadmap-ready context.
        </p>
        <div className="tw-flex tw-flex-wrap tw-gap-3">
          <button
            type="button"
            className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-slate-900 tw-px-4 tw-py-2 tw-text-sm tw-font-medium tw-text-slate-100 tw-transition tw-duration-200 tw-ease-out hover:tw-border-slate-700 disabled:tw-opacity-60"
            onClick={handlePromote}
            disabled={!hasMessages || isPromoting}
          >
            {isPromoting ? "Exporting…" : "Promote to Project"}
          </button>
          <span className="tw-text-sm tw-text-slate-400">
            Each turn is saved to <code className="tw-text-xs">/tmp/ideas</code> so you can reuse the transcript later.
          </span>
      </div>
      </div>

      {error && (
        <div className="tw-rounded-2xl tw-border tw-border-red-500/40 tw-bg-red-500/10 tw-p-4 tw-text-sm tw-text-red-200">
          <p className="tw-font-semibold">{error.title}</p>
          {error.detail && <p className="tw-mt-1 tw-text-red-200">{error.detail}</p>}
        </div>
      )}

      {promoteMessage && (
        <div className="tw-rounded-2xl tw-border tw-border-emerald-500/40 tw-bg-emerald-500/10 tw-p-4 tw-text-sm tw-text-emerald-200">
          {promoteMessage}
        </div>
      )}

      <div className="tw-flex tw-flex-col tw-gap-4 tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-900 tw-p-6 tw-max-h-[60vh] tw-overflow-y-auto">
        {hasMessages ? (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={
                message.role === "user"
                  ? "tw-ml-auto tw-max-w-[75%] tw-rounded-2xl tw-bg-slate-800 tw-px-4 tw-py-3 tw-text-sm tw-text-slate-100"
                  : "tw-mr-auto tw-max-w-[75%] tw-rounded-2xl tw-bg-slate-950 tw-px-4 tw-py-3 tw-text-sm tw-text-slate-200"
              }
            >
              <p className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-slate-400">
                {message.role === "user" ? "You" : "AI Partner"}
              </p>
              <p className="tw-mt-1 tw-whitespace-pre-line">{message.content}</p>
            </div>
          ))
        ) : (
          <div className="tw-text-sm tw-text-slate-400">
            Start a conversation with your idea. The assistant will help you shape, expand, and stress-test it.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={sendMessage} className="tw-space-y-3">
        <label htmlFor="brainstorm-input" className="tw-text-sm tw-font-medium tw-text-slate-200">
          Drop your next thought
        </label>
        <textarea
          id="brainstorm-input"
          className="tw-min-h-[140px] tw-rounded-3xl tw-border tw-border-slate-800 tw-bg-slate-950 tw-p-4 tw-text-sm tw-text-slate-100 focus:tw-border-slate-700"
          placeholder={placeholder}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={isSending}
        />
        <div className="tw-flex tw-items-center tw-justify-between">
          <p className="tw-text-xs tw-text-slate-400">
            OpenAI key required: set <code className="tw-text-[0.75rem]">OPENAI_API_KEY</code> in your environment.
          </p>
          <button
            type="submit"
            className="tw-inline-flex tw-items-center tw-gap-2 tw-rounded-full tw-border tw-border-slate-800 tw-bg-blue-600/10 tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-text-blue-200 tw-transition tw-duration-200 tw-ease-out hover:tw-border-blue-500/60 disabled:tw-opacity-60"
            disabled={isSending || !input.trim()}
          >
            {isSending ? "Thinking…" : "Send idea"}
          </button>
        </div>
      </form>
    </section>
  );
}
