import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationDeliveryService } from "../notification-delivery.service";

/**
 * A21 exit criterion — the command is:
 *
 *   npx vitest run src/modules/notifications/tests/a21-exit.spec.ts
 *
 * "Every notification in the platform routes through it; a per-user preference
 *  suppresses delivery across all 45 modules; delivery status is queryable.
 *  No module sends mail directly (G-5)."
 *
 * The spec is deliberately split into static checks (no direct mail, no direct
 * prisma.notification writes anywhere outside the engine) and behavioural
 * checks (the engine consults per-user preferences, writes queryable delivery
 * logs, honours quiet hours). It FAILED before this phase and must FAIL again
 * if any module bypasses the engine or the engine stops consulting preferences.
 */

const SPEC_DIR = fileURLToPath(new URL(".", import.meta.url));
const MODULES_ROOT = join(SPEC_DIR, "..", ".."); // src/modules

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

// Every source file in the 44 non-notification modules (test/spec files excluded).
const MODULE_FILES = walk(MODULES_ROOT).filter((f) => {
  const rel = relative(MODULES_ROOT, f).split(sep);
  if (rel[0] === "notifications") return false;
  if (rel.some((p) => p === "tests" || p === "specs" || p.endsWith(".spec")))
    return false;
  return true;
});

const ENGINE_FILE = join(MODULES_ROOT, "notifications", "notification-delivery.service.ts");
const DEEP_SERVICE_FILE = join(MODULES_ROOT, "notifications", "notifications-deep.service.ts");
const DEEP_CONTROLLER_FILE = join(MODULES_ROOT, "notifications", "notifications-deep.controller.ts");

// ─────────────────────────────────────────────────────────────────────────────
// Shared prisma mock (inlined so vitest's hoisted vi.mock factory is
// self-contained). `idpPrisma` routes lazily to `@kannan19302/database` delegates, so
// exporting the same stub under both names keeps every `vi.mocked(...)` setup
// pointing at exactly the function the service calls.
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@kannan19302/database", () => {
  const prisma = {
    user: { findFirst: vi.fn() },
    userPresence: { findFirst: vi.fn() },
    notification: { create: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
    notificationDigest: { findFirst: vi.fn() },
    notificationDeliveryLog: { create: vi.fn(), findMany: vi.fn() },
    notificationTemplate: { findUnique: vi.fn() },
    pushDeviceToken: { findMany: vi.fn() },
    webhookSubscription: { findMany: vi.fn() },
    webhookDeliveryLog: { create: vi.fn() },
  };
  return { prisma, idpPrisma: prisma };
});

// Time helpers for quiet-hour windows that always contain / never contain now.
function hhmm(offsetMinutes: number): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe("A21 exit criterion — unified notification & delivery engine", () => {
  // ── Static: G-5, no module sends mail directly ────────────────────────────
  describe("G-5 — no module sends mail directly", () => {
    it("no src/modules/** file (outside notifications & tests) references nodemailer or sendMail(", () => {
      const offenders = MODULE_FILES.filter((f) =>
        /nodemailer|sendMail\(/.test(readFileSync(f, "utf8")),
      );
      expect(offenders, `direct mail-send sites:\n${offenders.join("\n")}`).toEqual([]);
    });

    it("the engine is the single mail route: it injects the email queue and enqueues via it", () => {
      const src = readFileSync(ENGINE_FILE, "utf8");
      expect(src).toContain("InjectQueue");
      expect(src).toContain("emailQueue.add");
    });
  });

  // ── Static: every notification routes through the engine ──────────────────
  describe("G-5 — every notification routes through the engine", () => {
    it("no src/modules/** file (outside notifications & tests) writes prisma.notification.create", () => {
      const offenders = MODULE_FILES.filter((f) =>
        /prisma\.notification\.create/.test(readFileSync(f, "utf8")),
      );
      expect(offenders, `direct notification writes:\n${offenders.join("\n")}`).toEqual([]);
    });

    it("modules from across the platform emit `notification.send` through the event bus", () => {
      const emitters = [
        "workflow/workflow-engine.service.ts",
        "admin/automation-rule-engine.service.ts",
        "supply-chain/services/logistics-tracking.service.ts",
        "advanced-finance/services/tax-engine.service.ts",
        "crm/crm-revenue-intelligence.service.ts",
        "documents/services/signature-workflow.service.ts",
      ];
      for (const e of emitters) {
        expect(
          readFileSync(join(MODULES_ROOT, e), "utf8"),
          `${e} must route through notification.send`,
        ).toMatch(/notification\.send/);
      }
    });

    it("delivery status is queryable: deep service reads notificationDeliveryLog and the controller exposes it", () => {
      expect(readFileSync(DEEP_SERVICE_FILE, "utf8")).toContain(
        "notificationDeliveryLog.findMany",
      );
      expect(readFileSync(DEEP_CONTROLLER_FILE, "utf8")).toContain("delivery-logs");
    });
  });

  // ── Behavioural: the engine IS the choke point ─────────────────────────────
  describe("per-user preference suppresses delivery across modules", () => {
    let service: NotificationDeliveryService;

    beforeEach(async () => {
      service = new NotificationDeliveryService();
      vi.clearAllMocks();
      const { prisma } = await import("@kannan19302/database");
      vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.notificationDigest.findFirst).mockResolvedValue(null as never);
      vi.mocked(prisma.userPresence.findFirst).mockResolvedValue({
        presence: "ACTIVE",
      } as never);
      vi.mocked(prisma.pushDeviceToken.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.notification.create).mockResolvedValue({
        id: "n-1",
        status: "UNREAD",
      } as never);
      vi.mocked(prisma.notificationDeliveryLog.create).mockResolvedValue({
        id: "log-1",
      } as never);
    });

    it("disabling EMAIL for one user suppresses only that user's email, other users still receive it", async () => {
      const { prisma } = await import("@kannan19302/database");
      vi.mocked(prisma.user.findFirst).mockImplementation((({ where }) => ({
        email: where?.id === "u-a" ? "a@x.io" : "b@x.io",
      })) as never);
      vi.mocked(prisma.notificationPreference.findMany).mockImplementation((({ where }) =>
        Promise.resolve(
          where?.userId === "u-a"
            ? [{ channelName: "EMAIL", eventType: "CHAT", isEnabled: false }]
            : [],
        ),
      ) as never);

      await service.handleNotification({
        tenantId: "t1",
        userId: "u-a",
        type: "CHAT",
        title: "hi",
        channel: "EMAIL",
      });
      await service.handleNotification({
        tenantId: "t1",
        userId: "u-b",
        type: "CHAT",
        title: "hi",
        channel: "EMAIL",
      });

      expect(vi.mocked(prisma.notificationDeliveryLog.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "u-a",
          channel: "EMAIL",
          status: "SUPPRESSED",
        }),
      });
      expect(vi.mocked(prisma.notificationDeliveryLog.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "u-b",
          channel: "EMAIL",
          status: "QUEUED",
          metadata: { to: "b@x.io" },
        }),
      });
    });

    it("a single global preference suppresses in-app delivery for event types emitted by different modules", async () => {
      const { prisma } = await import("@kannan19302/database");
      vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([
        { channelName: "IN_APP", eventType: "*", isEnabled: false },
      ] as never);

      const moduleEvents = [
        { type: "CHAT" }, // communication
        { type: "AUTOMATION_RULE" }, // admin
        { type: "INVOICE_OVERDUE" }, // finance
        { type: "SIGNATURE_REQUESTED" }, // documents
        { type: "SHIPMENT_STATUS" }, // supply-chain
        { type: "DEAL_STAGE" }, // crm
      ];
      for (const ev of moduleEvents) {
        await service.handleNotification({
          tenantId: "t1",
          userId: "u1",
          ...ev,
          title: "x",
          channel: "IN_APP",
        });
      }

      expect(vi.mocked(prisma.notification.create)).not.toHaveBeenCalled();
      expect(vi.mocked(prisma.notificationDeliveryLog.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: "IN_APP", status: "SUPPRESSED" }),
      });
    });

    it("writes queryable delivery logs with status for every delivered channel (ALL)", async () => {
      const { prisma } = await import("@kannan19302/database");
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ email: "c@x.io" } as never);
      vi.mocked(prisma.pushDeviceToken.findMany).mockResolvedValue([
        { deviceId: "d1", platform: "ANDROID" },
      ] as never);

      await service.handleNotification({
        tenantId: "t1",
        userId: "u1",
        type: "CHAT",
        title: "hi",
        channel: "ALL",
      });

      expect(vi.mocked(prisma.notification.create)).toHaveBeenCalledTimes(1);
      const log = vi.mocked(prisma.notificationDeliveryLog.create);
      expect(log).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: "IN_APP", status: "QUEUED" }),
      });
      expect(log).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: "EMAIL", status: "QUEUED", metadata: { to: "c@x.io" } }),
      });
      expect(log).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: "PUSH", status: "QUEUED" }),
      });
    });

    it("quiet hours suppress non-urgent EMAIL/PUSH but urgent notifications bypass them", async () => {
      const { prisma } = await import("@kannan19302/database");
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ email: "q@x.io" } as never);
      vi.mocked(prisma.notificationDigest.findFirst).mockResolvedValue({
        preferences: {
          quietHours: { enabled: true, start: hhmm(-90), end: hhmm(90) },
        },
      } as never);

      await service.handleNotification({
        tenantId: "t1",
        userId: "u1",
        type: "SYSTEM",
        title: "night",
        channel: "EMAIL",
      });
      expect(vi.mocked(prisma.notificationDeliveryLog.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: "EMAIL", status: "SUPPRESSED" }),
      });

      await service.handleNotification({
        tenantId: "t1",
        userId: "u1",
        type: "SYSTEM",
        title: "urgent",
        channel: "EMAIL",
        urgent: true,
      });
      expect(vi.mocked(prisma.notificationDeliveryLog.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: "EMAIL", status: "QUEUED", metadata: { to: "q@x.io" } }),
      });
    });
  });
});
