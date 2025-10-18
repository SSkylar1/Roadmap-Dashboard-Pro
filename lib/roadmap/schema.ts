import { z } from "zod";

export const RoadmapItem = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  phase: z.string().optional(),
  week_range: z.string().optional(),
  status: z.enum(["todo","in_progress","done"]).default("todo"),
  tags: z.array(z.string()).default([]),
});

export const RoadmapDoc = z.object({
  title: z.string().min(1),
  phases: z.array(z.object({
    name: z.string(),
    items: z.array(RoadmapItem),
  })).default([]),
});

export type RoadmapDoc = z.infer<typeof RoadmapDoc>;

export function normalize(doc: RoadmapDoc) {
  const items = doc.phases.flatMap(p =>
    p.items.map(i => ({ ...i, phase: i.phase ?? p.name }))
  );
  return { title: doc.title, items };
}