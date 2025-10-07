export const CONCEPT_HANDOFF_KEY = "wizard:handoff:concept";

export const ROADMAP_HANDOFF_KEY = "wizard:handoff:roadmap";

export type RoadmapWizardHandOffPayload = {
  owner?: string;
  repo?: string;
  branch?: string;
  promotedBranch?: string;
  project?: string | null;
  [key: string]: unknown;
};
