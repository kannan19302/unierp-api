import { SetMetadata } from "@nestjs/common";

/**
 * Declares the server-side authority model that protects a controller.
 *
 * Permission strings describe tenant-staff capability checks. Customer portal
 * users instead require a portal-session guard plus customer-record scoping;
 * applying the staff RBAC guard there would both deny legitimate customers and
 * hide the distinct record-authorization contract. New boundary kinds need a
 * published owning security contract and an inventory-checker update.
 */
export const AUTHORIZATION_BOUNDARY_KEY = "authorizationBoundary";
export type AuthorizationBoundaryKind = "tenant-staff" | "customer-portal";

export const AuthorizationBoundary = (kind: AuthorizationBoundaryKind) =>
  SetMetadata(AUTHORIZATION_BOUNDARY_KEY, kind);
