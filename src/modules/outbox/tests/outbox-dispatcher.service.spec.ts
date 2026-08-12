import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OutboxDispatcherService } from "../outbox-dispatcher.service";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@nestjs/bullmq", () => ({
  InjectQueue: () => vi.fn(),
}));

describe("OutboxDispatcherService", () => {
  let service: OutboxDispatcherService;
  let mockQueue: { addBulk: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue = { addBulk: vi.fn().mockResolvedValue(undefined) };
    service = new OutboxDispatcherService(mockQueue as never);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it("should claim and enqueue deliveries", async () => {
    const { prisma } = await import("@kannan19302/database");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: "del-1",
        tenant_id: "t-1",
        outbox_event_id: "evt-1",
        destination: "inventory",
      },
      {
        id: "del-2",
        tenant_id: "t-1",
        outbox_event_id: "evt-2",
        destination: "finance",
      },
    ]);

    await service.poll();

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(mockQueue.addBulk).toHaveBeenCalledOnce();
    expect(mockQueue.addBulk).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: "del-1",
          data: expect.objectContaining({ deliveryId: "del-1" }),
          opts: expect.objectContaining({
            jobId: expect.stringMatching(/^del-1:/),
          }),
        }),
        expect.objectContaining({
          name: "del-2",
          data: expect.objectContaining({ deliveryId: "del-2" }),
          opts: expect.objectContaining({
            jobId: expect.stringMatching(/^del-2:/),
          }),
        }),
      ]),
    );
  });

  it("J18: a replayed dead-lettered delivery gets a fresh jobId, not the id of its already-terminal job", async () => {
    const { prisma } = await import("@kannan19302/database");

    // First poll: the delivery is claimed and enqueued (and, in reality,
    // eventually dies and its BullMQ job — under whatever jobId was used
    // — sits in the failed set for a long time per removeOnFail: 5000).
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      {
        id: "del-dead",
        tenant_id: "t-1",
        outbox_event_id: "evt-dead",
        destination: "inventory",
      },
    ]);
    await service.poll();
    const firstJobId = mockQueue.addBulk.mock.calls[0][0][0].opts.jobId;

    // replayDeadLetter() reset the row to PENDING; this dispatcher
    // re-claims and re-enqueues it on a later poll.
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      {
        id: "del-dead",
        tenant_id: "t-1",
        outbox_event_id: "evt-dead",
        destination: "inventory",
      },
    ]);
    await service.poll();
    const secondJobId = mockQueue.addBulk.mock.calls[1][0][0].opts.jobId;

    // If these ever collide, BullMQ will not schedule a new attempt for
    // the replay — it will just hand back the already-dead job.
    expect(secondJobId).not.toBe(firstJobId);
  });

  it("should not enqueue when no deliveries claimed", async () => {
    const { prisma } = await import("@kannan19302/database");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);

    await service.poll();

    expect(mockQueue.addBulk).not.toHaveBeenCalled();
  });

  it("should handle errors gracefully", async () => {
    const { prisma } = await import("@kannan19302/database");
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("DB error"));

    await expect(service.poll()).resolves.not.toThrow();
  });
});
