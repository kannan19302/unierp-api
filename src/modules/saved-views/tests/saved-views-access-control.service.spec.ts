/**
 * E08 exit criterion: "Every list in every module supports saved views
 * with no per-module code. A shared view respects the viewer's
 * permissions, not the author's."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let views: any[];
let shares: any[];
let layouts: any[];
let filters: any[];
let columns: any[];

vi.mock("@kannan19302/database", () => ({
  prisma: {
    savedView: {
      findFirst: vi.fn(({ where }: any) => views.find((v) => v.id === where.id && v.tenantId === where.tenantId) ?? null),
    },
    savedViewSharing: {
      findFirst: vi.fn(({ where }: any) =>
        shares.find((s) => s.tenantId === where.tenantId && s.viewId === where.viewId && s.sharedWithUserId === where.sharedWithUserId) ?? null,
      ),
      findMany: vi.fn(() => []),
    },
    savedViewLayout: {
      findFirst: vi.fn(({ where }: any) => layouts.find((l) => l.tenantId === where.tenantId && l.userId === where.userId && l.viewId === where.viewId) ?? null),
    },
    savedViewFilter: {
      findMany: vi.fn(() => filters),
    },
    savedViewColumnConfig: {
      findMany: vi.fn(() => columns),
    },
  },
}));

import { SavedViewsDeepService } from "../saved-views-deep.service";

describe("E08 · a saved view's config is never returned to a caller who neither owns it nor was shared it", () => {
  let service: SavedViewsDeepService;

  beforeEach(() => {
    vi.clearAllMocks();
    views = [{ id: "view-1", tenantId: "t1", userId: "author-1", resourceName: "customers", name: "My View" }];
    shares = [];
    layouts = [];
    filters = [{ id: "f1", tenantId: "t1", viewId: "view-1", isActive: true, field: "status", value: "active" }];
    columns = [];
    service = new SavedViewsDeepService();
  });

  it("REFUSES to return a view's filters/config to a user who neither owns it nor has an active share — the pre-existing gap this phase fixes", async () => {
    await expect(service.applyViewConfig("t1", "random-unauthorized-user", "view-1", "customers")).rejects.toThrow(/not authorized|forbidden/i);
  });

  it("ALLOWS the view's own author to apply it", async () => {
    const result = await service.applyViewConfig("t1", "author-1", "view-1", "customers");
    expect(result.filters).toEqual(filters);
  });

  it("ALLOWS a user the view was genuinely shared with — respecting a real, checked grant, not inherited author access", async () => {
    shares.push({ id: "share-1", tenantId: "t1", viewId: "view-1", sharedWithUserId: "colleague-1", sharedByUserId: "author-1", permission: "view" });
    const result = await service.applyViewConfig("t1", "colleague-1", "view-1", "customers");
    expect(result.filters).toEqual(filters);
  });
});
