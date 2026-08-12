/**
 * E27 exit criterion: "...quota..." — a tenant's configured storageLimit
 * must actually be enforced when registering a new file, not just stored
 * as an unread number.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let quota: any;
let files: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    storageFolder: { findFirst: vi.fn(() => null) },
    storedFile: {
      create: vi.fn(({ data }: any) => {
        const row = { id: "file-1", ...data };
        files.push(row);
        return row;
      }),
    },
    storageQuota: {
      findUnique: vi.fn(() => quota),
      create: vi.fn(({ data }: any) => {
        quota = { id: "q1", storageUsed: 0n, storageLimit: 1073741824n, fileCount: 0, ...data };
        return quota;
      }),
      update: vi.fn(({ data }: any) => {
        if (data.storageUsed?.increment !== undefined) quota.storageUsed += BigInt(data.storageUsed.increment);
        if (data.fileCount?.increment !== undefined) quota.fileCount += data.fileCount.increment;
        return quota;
      }),
    },
  },
}));

import { StorageService } from "../storage.service";

describe("E27 · storage quota is enforced when registering a new file, not just stored as an unread number", () => {
  let service: StorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    files = [];
    quota = { id: "q1", tenantId: "t1", storageUsed: 900n * 1024n * 1024n, storageLimit: 1024n * 1024n * 1024n, fileCount: 3, folderCount: 0 }; // 900MB used of 1GB
    service = new StorageService();
  });

  it("REFUSES to register a file that would push storageUsed past storageLimit — the exit criterion's own 'quota' word", async () => {
    const oversized = 200 * 1024 * 1024; // 200MB - would push 900MB -> 1100MB, past the 1GB (1024MB) limit
    await expect(
      service.registerFile("t1", { name: "big.zip", bucket: "b", fileKey: "k", size: oversized, mimeType: "application/zip" }, "user-1"),
    ).rejects.toThrow(/quota|limit/i);
    expect(files.length).toBe(0); // never registered
  });

  it("ALLOWS registering a file that fits within the remaining quota", async () => {
    const fits = 50 * 1024 * 1024; // 50MB - 900MB + 50MB = 950MB, still under 1GB
    const file = await service.registerFile("t1", { name: "small.zip", bucket: "b", fileKey: "k2", size: fits, mimeType: "application/zip" }, "user-1");
    expect(file.id).toBe("file-1");
    expect(quota.storageUsed).toBe(900n * 1024n * 1024n + BigInt(fits));
  });
});
