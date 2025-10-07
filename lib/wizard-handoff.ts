export const CONCEPT_HANDOFF_KEY = "wizard:handoff:concept";
export const ROADMAP_HANDOFF_KEY = "wizard:handoff:roadmap";

export type RoadmapHandoffContext = {
  owner?: string;
  repo?: string;
  project?: string | null;
  branch?: string;
  promotedBranch?: string;
};

export type StoredRoadmapHandoff = RoadmapHandoffContext & {
  path?: string | null;
  label?: string;
  content?: string;
  prUrl?: string;
  pullRequestNumber?: number;
  createdAt?: number;
};
