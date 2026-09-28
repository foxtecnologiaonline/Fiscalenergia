import type { FindingSeverity, FindingType } from "@prisma/client";

export type FindingInput = {
  type: FindingType;
  ruleCode: string;
  severity: FindingSeverity;
  description: string;
  estimatedImpactAmount?: number | null;
};
