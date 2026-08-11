import { BadRequestException, Injectable } from "@nestjs/common";

export interface ValidationFailure {
  field: string;
  rule: string;
  /** Remediation text an operator can act on — not "invalid value", but
   *  what to change and to what. */
  fix: string;
}

export type ValidationRule = (state: Record<string, unknown>) => ValidationFailure | null;

export type ValidationResult =
  | { valid: true }
  | { valid: false; failures: ValidationFailure[] };

/**
 * M10 — pre-flight validation per resource kind. A rule is code (the same
 * registry-of-code pattern M02/M03/M05/M08 already use); this service only
 * runs the registered rules for a kind and collects what fails.
 */
@Injectable()
export class ValidationService {
  private readonly rules = new Map<string, ValidationRule[]>();

  registerValidator(resourceKindName: string, rules: ValidationRule[]): void {
    this.rules.set(resourceKindName, rules);
  }

  /**
   * The exit criterion's first half: "a failing pre-flight names the
   * field, the rule and the fix." Every rule either passes (returns null)
   * or returns exactly that triple — there is no path to a bare boolean.
   */
  validate(resourceKindName: string, state: Record<string, unknown>): ValidationResult {
    const rules = this.rules.get(resourceKindName);
    if (!rules) {
      throw new BadRequestException(`No validator registered for resource kind "${resourceKindName}"`);
    }
    const failures: ValidationFailure[] = [];
    for (const rule of rules) {
      const failure = rule(state);
      if (failure) failures.push(failure);
    }
    return failures.length === 0 ? { valid: true } : { valid: false, failures };
  }
}
