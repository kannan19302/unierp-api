import { describe, it, expect, vi, beforeEach } from "vitest";
import { AlertsService } from "../alerts.service";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    adminAlert: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    alertThreshold: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@kannan19302/database";

/**
 * L12 — replaces the always-passing
 * the try/catch idiom where both branches only assert the value is not undefined
 * idiom (D016/L11) with assertions that name the exact prisma call each
 * method makes and fail if that call, or the value AlertsService returns,
 * changes.
 */
describe("AlertsService", () => {
  let service: AlertsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AlertsService();
  });

  it("getAlerts queries only this tenant's non-dismissed alerts, newest first", async () => {
    const rows = [{ id: "a1" }];
    (prisma.adminAlert.findMany as any).mockResolvedValue(rows);

    const result = await service.getAlerts("t1");

    expect(prisma.adminAlert.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", isDismissed: false },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toBe(rows);
  });

  it("getAlerts(unreadOnly=true) additionally filters to isRead: false", async () => {
    (prisma.adminAlert.findMany as any).mockResolvedValue([]);

    await service.getAlerts("t1", true);

    expect(prisma.adminAlert.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", isDismissed: false, isRead: false },
      orderBy: { createdAt: "desc" },
    });
  });

  it("markRead updates isRead:true for exactly this tenant's alert", async () => {
    const updated = { id: "alert-1", isRead: true };
    (prisma.adminAlert.update as any).mockResolvedValue(updated);

    const result = await service.markRead("t1", "alert-1");

    expect(prisma.adminAlert.update).toHaveBeenCalledWith({
      where: { id: "alert-1", tenantId: "t1" },
      data: { isRead: true },
    });
    expect(result).toBe(updated);
  });

  it("dismissAlert updates isDismissed:true for exactly this tenant's alert", async () => {
    const updated = { id: "alert-1", isDismissed: true };
    (prisma.adminAlert.update as any).mockResolvedValue(updated);

    const result = await service.dismissAlert("t1", "alert-1");

    expect(prisma.adminAlert.update).toHaveBeenCalledWith({
      where: { id: "alert-1", tenantId: "t1" },
      data: { isDismissed: true },
    });
    expect(result).toBe(updated);
  });

  it("markAllRead bulk-updates only unread, non-dismissed alerts for this tenant", async () => {
    (prisma.adminAlert.updateMany as any).mockResolvedValue({ count: 3 });

    const result = await service.markAllRead("t1");

    expect(prisma.adminAlert.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", isRead: false, isDismissed: false },
      data: { isRead: true },
    });
    expect(result).toEqual({ count: 3 });
  });

  it("getThresholds queries only this tenant's thresholds, newest first", async () => {
    const rows = [{ id: "th1" }];
    (prisma.alertThreshold.findMany as any).mockResolvedValue(rows);

    const result = await service.getThresholds("t1");

    expect(prisma.alertThreshold.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1" },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toBe(rows);
  });

  it("upsertThreshold applies documented defaults (WARNING severity, active, email on, 60min cooldown) when the caller omits them", async () => {
    (prisma.alertThreshold.upsert as any).mockResolvedValue({});

    await service.upsertThreshold("t1", { metric: "cpu", operator: "gt", value: 90 });

    expect(prisma.alertThreshold.upsert).toHaveBeenCalledWith({
      where: { tenantId_metric: { tenantId: "t1", metric: "cpu" } },
      create: {
        tenantId: "t1",
        metric: "cpu",
        operator: "gt",
        value: 90,
        severity: "WARNING",
        isActive: true,
        notifyEmail: true,
        cooldownMin: 60,
      },
      update: { operator: "gt", value: 90 },
    });
  });

  it("upsertThreshold's update branch only sets fields the caller actually provided", async () => {
    (prisma.alertThreshold.upsert as any).mockResolvedValue({});

    await service.upsertThreshold("t1", {
      metric: "cpu",
      operator: "gt",
      value: 95,
      severity: "CRITICAL",
      isActive: false,
    });

    expect(prisma.alertThreshold.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { operator: "gt", value: 95, severity: "CRITICAL", isActive: false },
      }),
    );
  });

  it("deleteThreshold deletes exactly this tenant's threshold by id", async () => {
    const deleted = { id: "th1" };
    (prisma.alertThreshold.delete as any).mockResolvedValue(deleted);

    const result = await service.deleteThreshold("t1", "th1");

    expect(prisma.alertThreshold.delete).toHaveBeenCalledWith({ where: { id: "th1", tenantId: "t1" } });
    expect(result).toBe(deleted);
  });

  it("createAlert defaults severity to WARNING and metadata to {} when omitted", async () => {
    (prisma.adminAlert.create as any).mockResolvedValue({});

    await service.createAlert("t1", { type: "DISK_SPACE", title: "Low disk", message: "90% full" });

    expect(prisma.adminAlert.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1",
        type: "DISK_SPACE",
        severity: "WARNING",
        title: "Low disk",
        message: "90% full",
        metadata: {},
      },
    });
  });

  it("createAlert passes through a caller-supplied severity and metadata unchanged", async () => {
    (prisma.adminAlert.create as any).mockResolvedValue({});

    await service.createAlert("t1", {
      type: "SECURITY",
      severity: "CRITICAL",
      title: "Breach attempt",
      message: "5 failed logins",
      metadata: { ip: "1.2.3.4" },
    });

    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ severity: "CRITICAL", metadata: { ip: "1.2.3.4" } }),
      }),
    );
  });
});
