import { SetMetadata } from "@nestjs/common";

export const STEP_UP_MFA_KEY = "stepUpMfaRequired";
export const RequireStepUpMfa = () => SetMetadata(STEP_UP_MFA_KEY, true);
