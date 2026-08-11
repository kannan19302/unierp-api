/**
 * M10 exit criterion: "A failing pre-flight names the field, the rule and
 * the fix. No provider SDK error reaches the UI unmapped — asserted by a
 * test that injects a raw provider error and expects a typed problem
 * document."
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ValidationService, type ValidationRule } from "./validation.service";
import { mapProviderError } from "./problem-document";

describe("M10 · validation and typed operational errors", () => {
  describe("pre-flight validation per resource kind", () => {
    let validator: ValidationService;

    const ttlMustBePositive: ValidationRule = (state) => {
      const ttl = state.ttl as number | undefined;
      if (ttl !== undefined && ttl <= 0) {
        return { field: "ttl", rule: "ttl-must-be-positive", fix: "Set ttl to a positive integer (seconds)." };
      }
      return null;
    };

    const recordCountWithinLimit: ValidationRule = (state) => {
      const count = state.recordCount as number | undefined;
      if (count !== undefined && count > 100) {
        return {
          field: "recordCount",
          rule: "record-count-within-limit",
          fix: "Reduce recordCount to 100 or fewer, or request a limit increase (M04 quota).",
        };
      }
      return null;
    };

    beforeEach(() => {
      validator = new ValidationService();
      validator.registerValidator("dns-zone", [ttlMustBePositive, recordCountWithinLimit]);
    });

    it("a failing pre-flight names the field, the rule and the fix", () => {
      const result = validator.validate("dns-zone", { ttl: -5, recordCount: 3 });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]).toEqual({
          field: "ttl",
          rule: "ttl-must-be-positive",
          fix: "Set ttl to a positive integer (seconds).",
        });
      }
    });

    it("a proposed state failing multiple rules reports all of them", () => {
      const result = validator.validate("dns-zone", { ttl: 0, recordCount: 500 });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.failures.map((f) => f.field).sort()).toEqual(["recordCount", "ttl"]);
      }
    });

    it("a compliant state passes with no failures", () => {
      const result = validator.validate("dns-zone", { ttl: 300, recordCount: 5 });
      expect(result).toEqual({ valid: true });
    });

    it("validating against an unregistered resource kind is refused explicitly, not silently accepted", () => {
      expect(() => validator.validate("unregistered-kind", {})).toThrow(/no validator registered/i);
    });
  });

  describe("no provider SDK error reaches the UI unmapped", () => {
    it("a raw connection-refused error is mapped to a typed problem document", () => {
      const rawError = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:587"), { code: "ECONNREFUSED" });
      const doc = mapProviderError(rawError, "/platform/v1/providers/prov-1/execute");

      expect(doc.status).toBe(502);
      expect(doc.title).toBe("Provider unreachable");
      expect(doc.detail).toContain("ECONNREFUSED");
      expect(doc.instance).toBe("/platform/v1/providers/prov-1/execute");
      expect(doc.remediation).toBeTruthy();
      expect(doc.type).toMatch(/^https:\/\//);
    });

    it("a raw authentication failure (401) is mapped with credential-rotation remediation", () => {
      const rawError = { status: 401, message: "Invalid API key" };
      const doc = mapProviderError(rawError);
      expect(doc.status).toBe(401);
      expect(doc.title).toBe("Provider authentication failed");
      expect(doc.remediation).toMatch(/credential/i);
    });

    it("a raw 429 rate-limit error is mapped with a quota-specific remediation", () => {
      const rawError = { statusCode: 429, message: "Too many requests" };
      const doc = mapProviderError(rawError);
      expect(doc.status).toBe(429);
      expect(doc.remediation).toMatch(/quota|rate/i);
    });

    it("a raw provider 500 is mapped as the provider's fault, not the caller's", () => {
      const rawError = { status: 503, message: "Service temporarily unavailable" };
      const doc = mapProviderError(rawError);
      expect(doc.status).toBe(502);
      expect(doc.title).toContain("internal error");
    });

    it("a completely unrecognised error shape still produces a typed document — the function is total", () => {
      const weirdInputs: unknown[] = [
        null,
        undefined,
        "a bare string thrown as an error",
        42,
        { somethingUnexpected: true },
        new Error("plain error, no code, no status"),
      ];
      for (const input of weirdInputs) {
        const doc = mapProviderError(input);
        expect(doc.status).toBeGreaterThanOrEqual(400);
        expect(doc.title).toBeTruthy();
        expect(doc.type).toMatch(/^https:\/\//);
        expect(doc.remediation).toBeTruthy();
      }
    });
  });
});
