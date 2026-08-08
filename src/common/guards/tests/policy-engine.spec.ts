/**
 * C02 exit criterion test — PolicyEngine.isControlPlane
 *
 * Exit criterion (verbatim from 12-TRACK-C-PLATFORM-CONSOLE.md § 2):
 *   "PolicyEngine.isControlPlane is exercised: a tenant wildcard grant (*)
 *    provably does NOT satisfy any platform.* or system.* permission."
 *
 * This file must not be weakened to make the criterion pass.
 */

import { describe, it, expect } from "vitest";
import {
  PolicyEngine,
  CONTROL_PLANE_ROLE,
  CONTROL_PLANE_ROLE_PERMISSIONS,
} from "@kannan19302/shared";

describe("PolicyEngine.isControlPlane (C02 exit criterion)", () => {
  // ── Gate 1: namespace detection ────────────────────────────────────────

  it("classifies system.* as control-plane", () => {
    expect(PolicyEngine.isControlPlane("system.tenant.read")).toBe(true);
    expect(PolicyEngine.isControlPlane("system.health.read")).toBe(true);
    expect(PolicyEngine.isControlPlane("system.analytics.read")).toBe(true);
  });

  it("classifies platform.* as control-plane", () => {
    expect(PolicyEngine.isControlPlane("platform.admin")).toBe(true);
    expect(PolicyEngine.isControlPlane("platform.sre")).toBe(true);
  });

  it("does NOT classify tenant-scoped namespaces as control-plane", () => {
    expect(PolicyEngine.isControlPlane("admin.user.read")).toBe(false);
    expect(PolicyEngine.isControlPlane("finance.invoice.create")).toBe(false);
    expect(PolicyEngine.isControlPlane("saas.flags.admin")).toBe(false);
    expect(PolicyEngine.isControlPlane("*")).toBe(false);
  });

  // ── Gate 2: wildcard isolation — the core C02 invariant ──────────────

  const CONTROL_PLANE_PERMS = [
    "system.tenant.read",
    "system.tenant.create",
    "system.tenant.update",
    "system.tenant.suspend",
    "system.tenant.unsuspend",
    "system.tenant.offboard",
    "system.tenant.purge",
    "system.tenant.export",
    "system.tenant.lifecycle.read",
    "system.superadmin.access",
    "system.analytics.read",
    "system.health.read",
    "system.operations.read",
    "system.operations.backup",
  ];

  it.each(CONTROL_PLANE_PERMS)(
    "tenant wildcard (*) does NOT satisfy control-plane permission: %s",
    (permission) => {
      const result = PolicyEngine.check(["*"], permission);
      expect(result).toBe(false);
    },
  );

  it.each(CONTROL_PLANE_PERMS)(
    "tenant admin wildcard (admin.*) does NOT satisfy control-plane permission: %s",
    (permission) => {
      const result = PolicyEngine.check(["admin.*"], permission);
      expect(result).toBe(false);
    },
  );

  it.each(CONTROL_PLANE_PERMS)(
    "saas wildcard (saas.*) does NOT satisfy control-plane permission: %s",
    (permission) => {
      const result = PolicyEngine.check(["saas.*"], permission);
      expect(result).toBe(false);
    },
  );

  // ── Gate 3: explicit control-plane grants do work ─────────────────────

  it("explicit control-plane permission satisfies itself", () => {
    expect(
      PolicyEngine.check(["system.tenant.read"], "system.tenant.read"),
    ).toBe(true);
  });

  it("system.* wildcard satisfies system.tenant.read", () => {
    expect(PolicyEngine.check(["system.*"], "system.tenant.read")).toBe(true);
  });

  it("platform.* wildcard satisfies platform.admin", () => {
    expect(PolicyEngine.check(["platform.*"], "platform.admin")).toBe(true);
  });

  // ── Gate 4: staff roles carry only control-plane permissions ──────────

  it("every PLATFORM_ADMIN permission is a control-plane permission", () => {
    const perms =
      CONTROL_PLANE_ROLE_PERMISSIONS[CONTROL_PLANE_ROLE.PLATFORM_ADMIN];
    for (const p of perms) {
      expect(
        PolicyEngine.isControlPlane(p),
        `${p} should be a control-plane permission`,
      ).toBe(true);
    }
  });

  it("every SRE permission is a control-plane permission", () => {
    const perms = CONTROL_PLANE_ROLE_PERMISSIONS[CONTROL_PLANE_ROLE.SRE];
    for (const p of perms) {
      expect(
        PolicyEngine.isControlPlane(p),
        `${p} should be a control-plane permission`,
      ).toBe(true);
    }
  });

  it("every SUPPORT_L1 permission is a control-plane permission", () => {
    const perms =
      CONTROL_PLANE_ROLE_PERMISSIONS[CONTROL_PLANE_ROLE.SUPPORT_L1];
    for (const p of perms) {
      expect(
        PolicyEngine.isControlPlane(p),
        `${p} should be a control-plane permission`,
      ).toBe(true);
    }
  });

  it("every SUPPORT_L2 permission is a control-plane permission", () => {
    const perms =
      CONTROL_PLANE_ROLE_PERMISSIONS[CONTROL_PLANE_ROLE.SUPPORT_L2];
    for (const p of perms) {
      expect(
        PolicyEngine.isControlPlane(p),
        `${p} should be a control-plane permission`,
      ).toBe(true);
    }
  });

  it("every BILLING permission is a control-plane permission", () => {
    const perms = CONTROL_PLANE_ROLE_PERMISSIONS[CONTROL_PLANE_ROLE.BILLING];
    for (const p of perms) {
      expect(
        PolicyEngine.isControlPlane(p),
        `${p} should be a control-plane permission`,
      ).toBe(true);
    }
  });

  it("every SECURITY permission is a control-plane permission", () => {
    const perms =
      CONTROL_PLANE_ROLE_PERMISSIONS[CONTROL_PLANE_ROLE.SECURITY];
    for (const p of perms) {
      expect(
        PolicyEngine.isControlPlane(p),
        `${p} should be a control-plane permission`,
      ).toBe(true);
    }
  });

  // ── Gate 5: BILLING cannot perform lifecycle operations ───────────────

  it("BILLING role does NOT have tenant lifecycle permissions", () => {
    const billingPerms =
      CONTROL_PLANE_ROLE_PERMISSIONS[CONTROL_PLANE_ROLE.BILLING];
    const dangerousPerms = [
      "system.tenant.suspend",
      "system.tenant.unsuspend",
      "system.tenant.offboard",
      "system.tenant.purge",
      "system.tenant.export",
      "system.tenant.lifecycle.read",
    ];
    for (const p of dangerousPerms) {
      expect(
        billingPerms.includes(p),
        `BILLING role must not have ${p}`,
      ).toBe(false);
    }
  });

  // ── Gate 6: SUPPORT_L1 is read-only ──────────────────────────────────

  it("SUPPORT_L1 has no write/lifecycle/purge permissions", () => {
    const l1Perms =
      CONTROL_PLANE_ROLE_PERMISSIONS[CONTROL_PLANE_ROLE.SUPPORT_L1];
    const writablePerms = [
      "system.tenant.create",
      "system.tenant.update",
      "system.tenant.suspend",
      "system.tenant.unsuspend",
      "system.tenant.offboard",
      "system.tenant.purge",
      "system.tenant.export",
      "system.superadmin.access",
      "system.operations.backup",
    ];
    for (const p of writablePerms) {
      expect(
        l1Perms.includes(p),
        `SUPPORT_L1 must not have ${p}`,
      ).toBe(false);
    }
  });
});
