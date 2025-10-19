export type RoadmapItemType = {
  id: string;
  title: string;
  phase?: string;
  week_range?: string;
  status?: "todo" | "in_progress" | "done";
  tags?: string[];
};

export type RoadmapPhase = {
  name: string;
  items: RoadmapItemType[];
};

export type RoadmapDocument = {
  title: string;
  phases: RoadmapPhase[];
};

type RoadmapValidationSuccess = { success: true; data: RoadmapDocument };
type RoadmapValidationError = { success: false; error: { format: () => { message: string } } };

type RoadmapValidationResult = RoadmapValidationSuccess | RoadmapValidationError;

function fail(message: string): RoadmapValidationError {
  return { success: false, error: { format: () => ({ message }) } };
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTags(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const tags = input
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return tags.length ? tags : undefined;
}

const ALLOWED_STATUS = new Set(["todo", "in_progress", "done"] as const);

export const RoadmapDoc = {
  safeParse(value: unknown): RoadmapValidationResult {
    if (typeof value !== "object" || value === null) {
      return fail("Roadmap must be an object");
    }

    const input = value as Record<string, unknown>;
    const title = normalizeString(input.title);
    if (!title) {
      return fail("Roadmap title must be a non-empty string");
    }

    const phasesInput = Array.isArray(input.phases) ? input.phases : [];
    const phases: RoadmapPhase[] = [];

    for (const phaseEntry of phasesInput) {
      if (typeof phaseEntry !== "object" || phaseEntry === null) {
        return fail("Each phase must be an object");
      }

      const phaseRecord = phaseEntry as Record<string, unknown>;
      const phaseName = normalizeString(phaseRecord.name);
      if (!phaseName) {
        return fail("Phase name must be a non-empty string");
      }

      const itemsInput = Array.isArray(phaseRecord.items) ? phaseRecord.items : [];
      const items: RoadmapItemType[] = [];

      for (const itemEntry of itemsInput) {
        if (typeof itemEntry !== "object" || itemEntry === null) {
          return fail("Roadmap items must be objects");
        }

        const itemRecord = itemEntry as Record<string, unknown>;
        const id = normalizeString(itemRecord.id);
        const itemTitle = normalizeString(itemRecord.title);
        if (!id || !itemTitle) {
          return fail("Roadmap items require non-empty id and title fields");
        }

        const normalized: RoadmapItemType = {
          id,
          title: itemTitle,
        };

        const explicitPhase = normalizeString(itemRecord.phase);
        if (explicitPhase) {
          normalized.phase = explicitPhase;
        }

        const weekRange = normalizeString(itemRecord.week_range);
        if (weekRange) {
          normalized.week_range = weekRange;
        }

        const status = normalizeString(itemRecord.status);
        if (ALLOWED_STATUS.has(status as any)) {
          normalized.status = status as RoadmapItemType["status"];
        } else {
          normalized.status = "todo";
        }

        const tags = normalizeTags(itemRecord.tags);
        if (tags) {
          normalized.tags = tags;
        }

        items.push(normalized);
      }

      phases.push({ name: phaseName, items });
    }

    return { success: true, data: { title, phases } };
  },
};

export function normalize(doc: RoadmapDocument) {
  const items = doc.phases.flatMap((phase) =>
    phase.items.map((item) => ({ ...item, phase: item.phase ?? phase.name })),
  );
  return { title: doc.title, items };
}
