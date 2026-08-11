import { SetMetadata } from "@nestjs/common";
import type { EstateCapability } from "../../platform/v1/estate-abac.service";

export const ESTATE_GRANT_KEY = "estateGrantRequired";

export interface EstateGrantRequirement {
  capability: EstateCapability;
  /** Route param carrying the resource id. Defaults to "id". */
  resourceIdParam?: string;
}

export const RequireEstateGrant = (requirement: EstateGrantRequirement) => SetMetadata(ESTATE_GRANT_KEY, requirement);
