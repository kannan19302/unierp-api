import { z } from "zod";

export const createAccessPackageSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  permissions: z.array(z.string()).default([]),
  fieldAccess: z
    .record(z.record(z.enum(["hidden", "readonly", "editable"])))
    .optional(),
  recordFilter: z.record(z.record(z.any())).optional(),
});

export const updateAccessPackageSchema = createAccessPackageSchema.partial();

export type CreateAccessPackageInput = z.infer<
  typeof createAccessPackageSchema
>;
export type UpdateAccessPackageInput = z.infer<
  typeof updateAccessPackageSchema
>;

export const offboardUserSchema = z.object({ reassignToUserId: z.string() });
export const transferOwnershipSchema = z.object({ toUserId: z.string() });
export const bulkUserActionSchema = z.object({ action: z.enum(['activate', 'suspend', 'offboard']), userIds: z.array(z.string()), targetUserId: z.string().optional() });
export type OffboardUserInput = z.infer<typeof offboardUserSchema>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
export type BulkUserActionInput = z.infer<typeof bulkUserActionSchema>;
