import { z } from "zod";

export const CreateSecurityPolicySchema = z.object({
  name: z.string().min(3, "Policy name must be at least 3 characters"),
  description: z.string().optional(),
  scopeType: z.enum(["PLATFORM", "REGION", "TENANT", "RESOURCE"]).default("PLATFORM"),
  scopeId: z.string().optional(),
  isolationLevel: z.enum(["ROW_LEVEL_SECURITY", "SCHEMA_PER_TENANT", "DATABASE_PER_TENANT", "CELL_ISOLATED"]).default("ROW_LEVEL_SECURITY"),
  enforcementMode: z.enum(["BLOCK", "ALERT", "DRY_RUN"]).default("BLOCK"),
  reason: z.string().optional(),
});

export type CreateSecurityPolicyDto = z.infer<typeof CreateSecurityPolicySchema>;

export const UpdateSecurityPolicySchema = z.object({
  name: z.string().min(3).optional(),
  description: z.string().optional(),
  scopeType: z.enum(["PLATFORM", "REGION", "TENANT", "RESOURCE"]).optional(),
  scopeId: z.string().optional(),
  isolationLevel: z.enum(["ROW_LEVEL_SECURITY", "SCHEMA_PER_TENANT", "DATABASE_PER_TENANT", "CELL_ISOLATED"]).optional(),
  enforcementMode: z.enum(["BLOCK", "ALERT", "DRY_RUN"]).optional(),
  reason: z.string().optional(),
});

export type UpdateSecurityPolicyDto = z.infer<typeof UpdateSecurityPolicySchema>;

export const ThreatTriageSchema = z.object({
  action: z.enum(["ACKNOWLEDGE", "INVESTIGATE", "RESOLVE", "CLOSE"]),
  notes: z.string().min(3, "Triage notes must be provided"),
  assignedTo: z.string().optional(),
});

export type ThreatTriageDto = z.infer<typeof ThreatTriageSchema>;
