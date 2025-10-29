export type TaskClarityCandidate = {
  title?: string | null;
  note?: string | null;
  checks?: Array<{ type?: string | null; detail?: string | null; globs?: string[] | null }>;
};

export type TaskClarityReport = {
  clarityScore: number;
  missingDetails: string[];
  followUpQuestions: string[];
  explanation?: string;
  usedOpenAi?: boolean;
};

export type TaskClarityOptions = {
  openAiKey?: string | null;
  signal?: AbortSignal;
};

const GENERIC_FALLBACK_SCORE = 0.55;
const MIN_WORDS_FOR_CONFIDENCE = 6;
const GENERIC_PLACEHOLDERS = [
  "tbd",
  "todo",
  "stuff",
  "things",
  "misc",
  "???",
  "n/a",
  "later",
  "ongoing",
  "investigate",
  "look into",
];
const OUTCOME_CUES = ["launch", "ship", "write", "document", "migrate", "measure", "design", "implement", "review"];
const SPECIFICITY_CUES = [/\bv?\d+(?:\.\d+)*\b/i, /\b(?:q[1-4]|week|sprint)\b/i, /\b[a-z]+\s+spec\b/i];

function normalizeText(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function wordCount(value: string) {
  if (!value) return 0;
  return value.split(/\s+/).filter(Boolean).length;
}

function hasPlaceholder(text: string) {
  const lower = text.toLowerCase();
  return GENERIC_PLACEHOLDERS.some((token) => lower.includes(token));
}

function hasOutcomeCue(text: string) {
  const lower = text.toLowerCase();
  return OUTCOME_CUES.some((token) => lower.includes(token));
}

function hasSpecificityCue(text: string) {
  return SPECIFICITY_CUES.some((regex) => regex.test(text));
}

function collectContext(candidate: TaskClarityCandidate) {
  const parts: string[] = [];
  const title = normalizeText(candidate.title);
  if (title) parts.push(title);
  const note = normalizeText(candidate.note);
  if (note) parts.push(note);
  for (const check of candidate.checks ?? []) {
    const detail = normalizeText(check?.detail ?? null);
    if (detail) parts.push(detail);
  }
  return parts.join(". ");
}

function heuristicAssessment(candidate: TaskClarityCandidate): TaskClarityReport {
  const title = normalizeText(candidate.title);
  const note = normalizeText(candidate.note);
  const combined = collectContext(candidate);
  const words = wordCount(title);
  const missingDetails: string[] = [];
  const followUps: string[] = [];

  if (!title) {
    missingDetails.push("Task is missing a clear title or description.");
    followUps.push("What outcome or deliverable should this item produce?");
  }

  if (title && words < MIN_WORDS_FOR_CONFIDENCE && !note) {
    missingDetails.push("Description is very short—add more context.");
    followUps.push("Can you provide a short sentence describing the expected result?");
  }

  if (hasPlaceholder(combined)) {
    missingDetails.push("Task still contains TBD-style placeholders.");
    followUps.push("Replace any TBD or placeholder text with the actual decision or owner.");
  }

  if (!hasOutcomeCue(combined)) {
    missingDetails.push("Task does not mention an action-oriented outcome.");
    followUps.push("What concrete action signals completion (e.g., launch docs, migrate data)?");
  }

  if (!hasSpecificityCue(combined)) {
    followUps.push("Are there milestones, dates, or owners that would make this clearer?");
  }

  let score = 1;
  if (!title) {
    score = 0.1;
  } else {
    if (words < MIN_WORDS_FOR_CONFIDENCE) {
      score -= 0.25;
    }
    if (!note && !hasOutcomeCue(combined)) {
      score -= 0.15;
    }
    if (hasPlaceholder(combined)) {
      score -= 0.3;
    }
    if (!hasSpecificityCue(combined)) {
      score -= 0.1;
    }
    if (score > 0.85 && followUps.length > 0) {
      score = Math.min(score, 0.8);
    }
  }

  if (score < 0.2 && missingDetails.length === 0) {
    missingDetails.push("Not enough information to evaluate clarity.");
  }

  score = Math.max(0, Math.min(1, score));

  return {
    clarityScore: score,
    missingDetails: Array.from(new Set(missingDetails)),
    followUpQuestions: Array.from(new Set(followUps)),
    explanation:
      score < 0.5
        ? "Heuristic scan flagged this item as vague."
        : score < 0.75
          ? "Heuristics suggest adding more detail for confidence."
          : "Heuristics consider this item mostly clear.",
  };
}

type OpenAiResponse = {
  clarityScore?: number;
  missingDetails?: unknown;
  followUpQuestions?: unknown;
  explanation?: unknown;
};

async function callOpenAi(
  candidate: TaskClarityCandidate,
  options: TaskClarityOptions,
  baseline: TaskClarityReport,
): Promise<TaskClarityReport | null> {
  const openAiKey = options.openAiKey?.trim();
  if (!openAiKey) {
    return null;
  }

  const promptParts = [
    `Roadmap item: ${normalizeText(candidate.title) || "(missing title)"}`,
    `Notes: ${normalizeText(candidate.note) || "(no extra notes)"}`,
  ];
  const checks = candidate.checks ?? [];
  if (checks.length > 0) {
    const lines = checks
      .map((check) => normalizeText(check?.detail ?? null))
      .filter(Boolean)
      .slice(0, 4);
    if (lines.length > 0) {
      promptParts.push(`Linked checks: ${lines.join("; ")}`);
    }
  }
  if (baseline.missingDetails.length > 0) {
    promptParts.push(`Heuristic concerns: ${baseline.missingDetails.join("; ")}`);
  }

  const payload = {
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system" as const,
        content:
          "You are a product operations assistant who evaluates roadmap items for clarity. " +
          "Respond with strict JSON and do not include markdown fences.",
      },
      {
        role: "user" as const,
        content:
          `${promptParts.join("\n")}\n\n` +
          "Return a JSON object with keys clarityScore (0-1), missingDetails (array of short bullet points), and followUpQuestions (array). " +
          "Only ask for follow-ups that would materially improve the description.",
      },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }>; }
    | null;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  let parsed: OpenAiResponse | null = null;
  try {
    parsed = JSON.parse(content) as OpenAiResponse;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]) as OpenAiResponse;
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed) {
    return null;
  }

  const clarityScore = typeof parsed.clarityScore === "number" ? parsed.clarityScore : baseline.clarityScore;
  const missingDetails = Array.isArray(parsed.missingDetails)
    ? (parsed.missingDetails.filter((value) => typeof value === "string" && value.trim()) as string[])
    : baseline.missingDetails;
  const followUpQuestions = Array.isArray(parsed.followUpQuestions)
    ? (parsed.followUpQuestions.filter((value) => typeof value === "string" && value.trim()) as string[])
    : baseline.followUpQuestions;
  const explanation =
    typeof parsed.explanation === "string" && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : baseline.explanation;

  return {
    clarityScore: Math.max(0, Math.min(1, clarityScore ?? GENERIC_FALLBACK_SCORE)),
    missingDetails: missingDetails.length > 0 ? missingDetails : baseline.missingDetails,
    followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : baseline.followUpQuestions,
    explanation,
    usedOpenAi: true,
  };
}

export async function evaluateTaskClarity(
  candidate: TaskClarityCandidate,
  options: TaskClarityOptions = {},
): Promise<TaskClarityReport> {
  const heuristic = heuristicAssessment(candidate);

  if (heuristic.clarityScore >= 0.72 || (heuristic.missingDetails.length === 0 && heuristic.followUpQuestions.length === 0)) {
    return heuristic;
  }

  try {
    const aiResult = await callOpenAi(candidate, options, heuristic);
    if (!aiResult) {
      return heuristic;
    }
    return {
      clarityScore: aiResult.clarityScore,
      missingDetails: aiResult.missingDetails,
      followUpQuestions: aiResult.followUpQuestions,
      explanation: aiResult.explanation,
      usedOpenAi: aiResult.usedOpenAi,
    };
  } catch {
    return heuristic;
  }
}
