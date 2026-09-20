import { z } from "zod";

export const createStaffPrincipalSchema = z.object({
  email: z.string().trim().email("Must be a valid email address"),
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  roleIds: z.array(z.string()).optional().default([]),
  temporaryPassword: z.string().min(8).optional(),
  mfaEnabled: z.boolean().optional().default(false),
});

export type CreateStaffPrincipalInput = z.infer<typeof createStaffPrincipalSchema>;

export const updateStaffPrincipalSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED", "LOCKED"]).optional(),
  roleIds: z.array(z.string()).optional(),
  mfaEnabled: z.boolean().optional(),
});

export type UpdateStaffPrincipalInput = z.infer<typeof updateStaffPrincipalSchema>;

export const staffPrincipalQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
  sort: z.string().trim().optional().default("lastName"),
  dir: z.enum(["asc", "desc"]).optional().default("asc"),
});

export type StaffPrincipalQueryInput = z.infer<typeof staffPrincipalQuerySchema>;

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, "Role name must have at least 2 characters").max(100),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string()).min(1, "At least one permission must be selected"),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string()).optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const roleQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().trim().optional(),
  sort: z.string().trim().optional().default("name"),
  dir: z.enum(["asc", "desc"]).optional().default("asc"),
});

export type RoleQueryInput = z.infer<typeof roleQuerySchema>;
