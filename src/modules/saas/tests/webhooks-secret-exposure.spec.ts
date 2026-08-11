/**
 * D20 exit criterion: "A failed webhook is visible, diagnosable and
 * replayable by the tenant admin, with credentials never rendered
 * after save."
 *
 * WebhooksService.getEndpoint()/listEndpoints() previously returned the
 * raw Prisma row, including the FULL, plaintext `secret` field, on
 * every read after creation — a real, mounted, guarded endpoint
 * (GET saas/webhooks/endpoints, GET saas/webhooks/endpoints/:id) leaked
 * the webhook signing secret on every subsequent view. This spec
 * proves the gap, then proves the fix: the secret is returned ONLY at
 * the moment it's generated (create/rotate — the "save" event itself),
 * never on any later read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let endpoints: any[];
let seq = 0;

vi.mock("@kannan19302/database", () => ({
  prisma: {
    tenantWebhookEndpoint: {
      create: vi.fn(({ data }: any) => { const row = { id: `wh-${++seq}`, createdAt: new Date(), ...data }; endpoints.push(row); return row; }),
      findMany: vi.fn(({ where }: any) => endpoints.filter((e) => e.tenantId === where.tenantId)),
      findFirst: vi.fn(({ where }: any) => endpoints.find((e) => e.id === where.id && e.tenantId === where.tenantId) ?? null),
      update: vi.fn(({ where: { id }, data }: any) => { const row = endpoints.find((e) => e.id === id)!; Object.assign(row, data); return row; }),
      delete: vi.fn(({ where: { id } }: any) => { endpoints = endpoints.filter((e) => e.id !== id); return {}; }),
    },
    tenantWebhookDelivery: { deleteMany: vi.fn(() => ({ count: 0 })) },
  },
}));
vi.mock("@/common/idp-client", () => ({ idpClient: {} }));

import { WebhooksService } from "../webhooks.service";

describe("D20 · webhook credentials are never rendered after save", () => {
  let webhooks: WebhooksService;

  beforeEach(() => {
    vi.clearAllMocks();
    endpoints = [];
    seq = 0;
    webhooks = new WebhooksService();
  });

  it("CREATE (the save event) DOES return the real secret — a one-time reveal at generation time", async () => {
    const created = await webhooks.createEndpoint("t1", { url: "https://example.com/hook", events: ["subscription.created"] });
    expect(created.secret).toBeDefined();
    expect(typeof created.secret).toBe("string");
    expect(created.secret!.length).toBeGreaterThan(10);
  });

  it("LIST never renders any endpoint's real secret", async () => {
    const created = await webhooks.createEndpoint("t1", { url: "https://example.com/hook", events: ["subscription.created"] });
    const list = await webhooks.listEndpoints("t1");

    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(created.secret);
    expect((list[0] as any).secret).toBeUndefined();
  });

  it("GET a single endpoint by id never renders the real secret", async () => {
    const created = await webhooks.createEndpoint("t1", { url: "https://example.com/hook", events: ["subscription.created"] });
    const fetched = await webhooks.getEndpoint("t1", created.id);

    expect(JSON.stringify(fetched)).not.toContain(created.secret);
    expect((fetched as any).secret).toBeUndefined();
  });

  it("UPDATE's return value never renders the real secret", async () => {
    const created = await webhooks.createEndpoint("t1", { url: "https://example.com/hook", events: ["subscription.created"] });
    const updated = await webhooks.updateEndpoint("t1", created.id, { description: "renamed" });

    expect(JSON.stringify(updated)).not.toContain(created.secret);
    expect((updated as any).secret).toBeUndefined();
  });

  it("getEndpointSecret returns NO real secret characters — a boolean/marker only, not a partial reveal", async () => {
    const created = await webhooks.createEndpoint("t1", { url: "https://example.com/hook", events: ["subscription.created"] });
    const result = await webhooks.getEndpointSecret("t1", created.id);

    expect(JSON.stringify(result)).not.toContain(created.secret!.substring(0, 10));
  });

  it("ROTATE (a new save event) DOES return the NEW real secret — the same one-time-reveal rule", async () => {
    const created = await webhooks.createEndpoint("t1", { url: "https://example.com/hook", events: ["subscription.created"] });
    const rotated = await webhooks.rotateSecret("t1", created.id);

    expect(rotated.secret).toBeDefined();
    expect(rotated.secret).not.toBe(created.secret); // genuinely a new secret
  });

  it("after rotating, a subsequent GET never renders the NEW secret either", async () => {
    const created = await webhooks.createEndpoint("t1", { url: "https://example.com/hook", events: ["subscription.created"] });
    const rotated = await webhooks.rotateSecret("t1", created.id);
    const fetched = await webhooks.getEndpoint("t1", created.id);

    expect(JSON.stringify(fetched)).not.toContain(rotated.secret);
  });
});
