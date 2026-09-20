import { z } from "zod";

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, "Tenant name must have at least 2 characters").max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with optional hyphens"),
  plan: z.string().trim().min(1).default("STARTUP"),
  adminEmail: z.string().trim().email("Valid admin email is required"),
  residencyRegion: z.string().trim().default("us-east-1"),
});

export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  plan: z.string().trim().min(1).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED", "TRIAL", "OFFBOARDING"]).optional(),
  residencyRegion: z.string().trim().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const tenantQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  sort: z.string().trim().default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type TenantQueryInput = z.infer<typeof tenantQuerySchema>;
