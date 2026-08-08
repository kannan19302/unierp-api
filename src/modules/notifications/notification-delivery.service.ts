import { Injectable, Optional } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { prisma } from "@unerp/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { OnEvent } from "@nestjs/event-emitter";
import { createHmac } from "node:crypto";

export type NotificationChannel =
  | "IN_APP"
  | "EMAIL"
  | "SMS"
  | "PUSH"
  | "WEBHOOK"
  | "ALL";

/**
 * The unified notification dispatch contract. Every module that needs to notify
 * a user (or an external recipient) emits `notification.send` (or
 * `notification.create`) with this shape; `NotificationDeliveryService` is the
 * single choke point that applies per-user preferences, quiet hours, template
 * rendering and delivery logging before anything reaches a transport.
 *
 * Mirrors `@unerp/contracts` `NotificationSendEvent` (L0, zero-dependency).
 */
export interface NotificationPayload {
  tenantId: string;
  /** Platform user the notification targets. Required for per-user preferences. */
  userId?: string;
  /** Direct recipient for transactional mail (invites, automation) — skips per-user preferences. */
  to?: string;
  /** Event type — the preference key, e.g. "CHAT", "INVOICE_OVERDUE", "AUTOMATION_RULE". */
  type: string;
  title: string;
  body?: string;
  channel?: NotificationChannel;
  /** Render subject/body from a NotificationTemplate instead of title/body. */
  templateId?: string;
  variables?: Record<string, string>;
  locale?: string;
  /** Bypasses quiet hours. */
  urgent?: boolean;
  /** Webhook channel payload body. */
  data?: Record<string, unknown>;
  /** In-app deep link. */
  link?: string;
}

interface NotificationPreferenceRow {
  channelName: string;
  eventType: string;
  isEnabled: boolean;
}

const EMAIL_QUEUE_JOB = "notification-email";
const DEFAULT_USER = "system";

/** True when the given HH:MM clock time is inside the [start, end) window (handles midnight wrap). */
function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  const hh = h !== undefined && Number.isFinite(h) ? h : 0;
  const mm = m !== undefined && Number.isFinite(m) ? m : 0;
  return hh * 60 + mm;
}

function isWithinQuietWindow(start: string, end: string, timeZone?: string): boolean {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(new Date());
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
  }
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const now = hhmmToMinutes(`${get("hour")}:${get("minute")}`);
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s <= e) return now >= s && now < e;
  return now >= s || now < e; // window crosses midnight
}

@Injectable()
export class NotificationDeliveryService {
  constructor(
    @Optional() @InjectQueue("email") private readonly emailQueue?: Queue,
  ) {}

  /**
   * The unified entry point for `notification.send` — the event every module in
   * the platform emits. All 45 modules route through this one handler, so a
   * single per-user preference suppresses delivery no matter which module
   * produced the event.
   */
  @OnEvent("notification.send")
  async handleNotification(payload: NotificationPayload) {
    const channel = payload.channel || "IN_APP";
    const channels = this.resolveChannels(channel);

    const disabled = await this.getDisabledChannels(payload);
    const quiet = payload.urgent ? false : await this.inQuietHours(payload);
    const presence = payload.userId
      ? await this.safeGetPresence(payload.tenantId, payload.userId)
      : null;
    const isDnd = presence?.presence === "DND";

    for (const ch of channels) {
      const suppressedByPref = disabled.has(ch) || disabled.has("*");
      const suppressedByDnd = isDnd && (ch === "EMAIL" || ch === "PUSH");
      const suppressedByQuiet = quiet && (ch === "EMAIL" || ch === "PUSH");

      if (suppressedByPref || suppressedByDnd || suppressedByQuiet) {
        await this.logDelivery(
          payload,
          ch,
          "SUPPRESSED",
          suppressedByPref
            ? "preference-disabled"
            : suppressedByDnd
              ? "dnd"
              : "quiet-hours",
        );
        continue;
      }

      switch (ch) {
        case "IN_APP": {
          const created = await this.deliverInApp(payload);
          await this.logDelivery(payload, "IN_APP", "QUEUED", undefined, created.id);
          break;
        }
        case "EMAIL":
          await this.deliverEmail(payload);
          break;
        case "SMS":
          await this.deliverSms(payload);
          break;
        case "PUSH":
          await this.deliverPush(payload);
          break;
        case "WEBHOOK":
          await this.deliverWebhook(payload);
          break;
      }
    }
  }

  /**
   * Synchronous variant of the engine used by controllers that need the created
   * in-app row back in the HTTP response. Same preference suppression, same
   * delivery logging — the return value is the created notification, or null
   * when the user's preference suppressed it.
   */
  @OnEvent("notification.create")
  async handleNotificationCreate(payload: NotificationPayload) {
    const disabled = await this.getDisabledChannels(payload);
    if (disabled.has("IN_APP") || disabled.has("*")) {
      await this.logDelivery(payload, "IN_APP", "SUPPRESSED", "preference-disabled");
      return null;
    }
    const created = await this.deliverInApp(payload);
    await this.logDelivery(payload, "IN_APP", "QUEUED", undefined, created.id);
    return created;
  }

  private resolveChannels(channel: NotificationChannel): NotificationChannel[] {
    if (channel === "ALL") return ["IN_APP", "EMAIL", "PUSH"];
    return [channel];
  }

  /** Channels the user has disabled for this event type (channelName or eventType may be "*"). */
  private async getDisabledChannels(
    payload: NotificationPayload,
  ): Promise<Set<string>> {
    if (!payload.userId) return new Set();
    const delegate = (prisma as any).notificationPreference;
    if (!delegate?.findMany) return new Set();
    let rows: NotificationPreferenceRow[] = [];
    try {
      rows = await delegate.findMany({
        where: {
          tenantId: payload.tenantId,
          userId: payload.userId,
          isEnabled: false,
        },
      });
    } catch {
      rows = [];
    }
    const disabled = new Set<string>();
    for (const r of rows ?? []) {
      if (r.eventType !== "*" && r.eventType !== payload.type) continue;
      disabled.add(r.channelName);
    }
    return disabled;
  }

  /** True when the user's digest preferences define a quiet-hours window containing now. */
  private async inQuietHours(payload: NotificationPayload): Promise<boolean> {
    if (!payload.userId) return false;
    const delegate = (prisma as any).notificationDigest;
    if (!delegate?.findFirst) return false;
    let digest: { preferences?: any } | null = null;
    try {
      digest = await delegate.findFirst({
        where: { tenantId: payload.tenantId, userId: payload.userId, isEnabled: true },
      });
    } catch {
      digest = null;
    }
    const q = digest?.preferences?.quietHours;
    if (!q?.enabled || typeof q.start !== "string" || typeof q.end !== "string") {
      return false;
    }
    return isWithinQuietWindow(q.start, q.end, q.timezone);
  }

  private async safeGetPresence(tenantId: string, userId: string) {
    try {
      return await idpPrisma.userPresence.findFirst({ where: { tenantId, userId } });
    } catch {
      return null;
    }
  }

  /** Renders subject/body from a NotificationTemplate when templateId is supplied. */
  private async renderContent(payload: NotificationPayload): Promise<{
    title: string;
    body?: string;
  }> {
    if (!payload.templateId) return { title: payload.title, body: payload.body };
    const delegate = (prisma as any).notificationTemplate;
    if (!delegate?.findUnique) return { title: payload.title, body: payload.body };
    let tmpl: { subject: string; body: string } | null = null;
    try {
      tmpl = await delegate.findUnique({ where: { id: payload.templateId } });
    } catch {
      tmpl = null;
    }
    if (!tmpl) return { title: payload.title, body: payload.body };
    const vars: Record<string, string> = { ...(payload.variables ?? {}) };
    if (payload.locale) vars.locale = payload.locale;
    let subject = tmpl.subject ?? payload.title;
    let body = tmpl.body ?? payload.body ?? "";
    for (const [key, value] of Object.entries(vars)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      subject = subject.replace(regex, String(value));
      body = body.replace(regex, String(value));
    }
    return { title: subject, body };
  }

  private async resolveUserEmail(payload: NotificationPayload): Promise<string | undefined> {
    if (!payload.userId) return undefined;
    try {
      const user = await idpPrisma.user.findFirst({
        where: { id: payload.userId, tenantId: payload.tenantId },
      });
      return user?.email ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async deliverInApp(payload: NotificationPayload) {
    const rendered = await this.renderContent(payload);
    return prisma.notification.create({
      data: {
        tenantId: payload.tenantId,
        userId: payload.userId ?? DEFAULT_USER,
        type: payload.type,
        title: rendered.title,
        content: rendered.body ?? "",
        status: "UNREAD",
        ...(payload.link ? { link: payload.link } : {}),
      },
    });
  }

  /**
   * Email delivery goes through the BullMQ `email` queue (the SMTP transport
   * owned by `common/queues/email.processor.ts`). The engine is the only place
   * a module's mail can originate — no module builds a transport or calls SMTP.
   */
  private async deliverEmail(payload: NotificationPayload) {
    const to = payload.to ?? (await this.resolveUserEmail(payload));
    if (!to) {
      await this.logDelivery(payload, "EMAIL", "SUPPRESSED", "no-recipient");
      return;
    }
    const rendered = await this.renderContent(payload);
    const job = {
      to,
      subject: rendered.title,
      body: rendered.body ?? "",
      tenantId: payload.tenantId,
      template: payload.templateId,
      variables: payload.variables,
    };
    if (this.emailQueue) {
      await this.emailQueue.add(EMAIL_QUEUE_JOB, job, { attempts: 3 });
    } else {
      const { pinoLogger } = await import("../../common/services/logger.service");
      pinoLogger.info(
        { channel: "EMAIL", to, subject: rendered.title, tenantId: payload.tenantId },
        "Email notification queued",
      );
    }
    await this.logDelivery(payload, "EMAIL", "QUEUED", undefined, undefined, { to });
  }

  /**
   * SMS delivery. No SMS gateway integration exists yet, so — with the same
   * honest "queued, not actually sent" fidelity as PUSH — the fan-out is logged
   * and a QUEUED delivery log is recorded rather than silently dropped.
   */
  private async deliverSms(payload: NotificationPayload) {
    const to = payload.to ?? (await this.resolveUserEmail(payload));
    if (!to) {
      await this.logDelivery(payload, "SMS", "SUPPRESSED", "no-recipient");
      return;
    }
    const { pinoLogger } = await import("../../common/services/logger.service");
    pinoLogger.info(
      { channel: "SMS", to, subject: payload.title, tenantId: payload.tenantId },
      "SMS notification queued",
    );
    await this.logDelivery(payload, "SMS", "QUEUED", undefined, undefined, { to });
  }

  /**
   * Fans a notification out to every active device token for this user
   * (.ai/MULTI_CLIENT_MASTER_PLAN.md § 7) — doubles as a cache-invalidation
   * signal for Flutter's read cache. Same "queued, not actually sent" fidelity
   * as email: no FCM/APNs/WNS integration exists yet, so this logs the fan-out
   * per device rather than silently dropping it.
   */
  private async deliverPush(payload: NotificationPayload) {
    const tokens = await prisma.pushDeviceToken.findMany({
      where: {
        tenantId: payload.tenantId,
        userId: payload.userId ?? DEFAULT_USER,
        isActive: true,
      },
    });
    if (!tokens.length) {
      await this.logDelivery(payload, "PUSH", "SUPPRESSED", "no-device-token");
      return;
    }
    const { pinoLogger } = await import("../../common/services/logger.service");
    for (const t of tokens) {
      pinoLogger.info(
        {
          channel: "PUSH",
          deviceId: t.deviceId,
          platform: t.platform,
          title: payload.title,
          tenantId: payload.tenantId,
        },
        "Push notification queued",
      );
    }
    await this.logDelivery(payload, "PUSH", "QUEUED", undefined, undefined, {
      devices: tokens.length,
    });
  }

  /** POSTs the payload to every ACTIVE webhook subscription matching the event type. */
  private async deliverWebhook(payload: NotificationPayload) {
    const delegate = (prisma as any).webhookSubscription;
    if (!delegate?.findMany) {
      await this.logDelivery(payload, "WEBHOOK", "SUPPRESSED", "webhook-not-configured");
      return;
    }
    let subs: Array<{
      id: string;
      targetUrl: string;
      events: unknown;
      secret?: string;
    }> = [];
    try {
      subs = await delegate.findMany({
        where: { tenantId: payload.tenantId, status: "ACTIVE" },
      });
    } catch {
      subs = [];
    }
    const matching = (subs ?? []).filter((s) => {
      const events = Array.isArray(s.events) ? (s.events as string[]) : [];
      return events.length === 0 || events.includes(payload.type);
    });
    if (!matching.length) {
      await this.logDelivery(payload, "WEBHOOK", "SUPPRESSED", "no-matching-subscription");
      return;
    }
    for (const sub of matching) {
      const body = JSON.stringify({
        eventType: payload.type,
        tenantId: payload.tenantId,
        data: payload.data ?? { title: payload.title, body: payload.body },
      });
      try {
        const signature = sub.secret
          ? createHmac("sha256", sub.secret).update(body).digest("hex")
          : undefined;
        const res = await fetch(sub.targetUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(signature ? { "x-unierp-signature": signature } : {}),
          },
          body,
        });
        await this.logDelivery(payload, "WEBHOOK", "QUEUED", undefined, undefined, {
          subscriptionId: sub.id,
          responseStatus: res.status,
        });
        const webhookLog = (prisma as any).webhookDeliveryLog;
        if (webhookLog?.create) {
          await webhookLog.create({
            data: {
              tenantId: payload.tenantId,
              subscriptionId: sub.id,
              event: payload.type,
              payload: body,
              responseStatus: res.status,
              status: res.ok ? "SUCCESS" : "FAILED",
            },
          });
        }
      } catch (e) {
        await this.logDelivery(
          payload,
          "WEBHOOK",
          "FAILED",
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  /** Records a delivery decision. Logging must never break delivery, so failures are swallowed. */
  private async logDelivery(
    payload: NotificationPayload,
    channel: NotificationChannel,
    status: string,
    errorMsg?: string,
    notificationId?: string,
    metadata?: Record<string, unknown>,
  ) {
    const delegate = (prisma as any).notificationDeliveryLog;
    if (!delegate?.create) return;
    const data: Record<string, unknown> = {
      tenantId: payload.tenantId,
      userId: payload.userId ?? DEFAULT_USER,
      channel,
      status,
      errorMsg,
      metadata: metadata ?? {},
    };
    if (notificationId) data.notificationId = notificationId;
    try {
      await delegate.create({ data });
    } catch {
      // delivery logging is best-effort
    }
  }

  async getUserNotifications(
    tenantId: string,
    userId: string,
    unreadOnly = false,
  ) {
    return prisma.notification.findMany({
      where: {
        tenantId,
        userId,
        ...(unreadOnly ? { status: "UNREAD" } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markAsRead(_tenantId: string, notificationId: string) {
    return prisma.notification.update({
      where: { id: notificationId },
      data: { status: "READ" },
    });
  }

  async markAllAsRead(tenantId: string, userId: string) {
    return prisma.notification.updateMany({
      where: { tenantId, userId, status: "UNREAD" },
      data: { status: "READ" },
    });
  }

  async getUnreadCount(tenantId: string, userId: string) {
    return prisma.notification.count({
      where: { tenantId, userId, status: "UNREAD" },
    });
  }
}
