import { SetMetadata } from "@nestjs/common";

export const TWO_PERSON_CONTROL_KEY = "twoPersonControl";
export const TwoPersonControl = () => SetMetadata(TWO_PERSON_CONTROL_KEY, true);
