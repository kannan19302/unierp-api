import { BuilderAdvancedFormsService } from "../services/builder-advanced-forms.service";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@kannan19302/database", () => ({
  prisma: {
    advancedForm: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "form-1" }),
      update: vi.fn().mockResolvedValue({ id: "form-1" }),
      delete: vi.fn().mockResolvedValue({ id: "form-1" }),
      count: vi.fn().mockResolvedValue(0),
    },
    formAnalytics: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    formVersion: {
      create: vi.fn().mockResolvedValue({ id: "ver-1" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe("BuilderAdvancedFormsService", () => {
  let service: BuilderAdvancedFormsService;

  beforeEach(() => {
    service = new BuilderAdvancedFormsService();
    vi.clearAllMocks();
  });

  it("getAdvancedForms returns paginated", async () => {
    const result = await service.getAdvancedForms("t1");
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("meta");
  });

  it("getAdvancedFormById throws on missing", async () => {
    await expect(service.getAdvancedFormById("t1", "none")).rejects.toThrow();
  });

  it("createConditionalForm succeeds", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue(null);
    const result = await service.createConditionalForm("t1", {
      name: "Form",
      slug: "form",
    });
    expect(result).toBeDefined();
  });

  it("projects an advanced form into a canonical immutable revision", async () => {
    const { prisma } = await import("@kannan19302/database");
    const artifacts = { record: vi.fn(async () => ({ id: "artifact-1" })) };
    const revisions = { syncLegacyProjection: vi.fn() };
    const migrated = new BuilderAdvancedFormsService(artifacts as any, revisions as any);
    (prisma.advancedForm.findFirst as any).mockResolvedValue(null);
    (prisma.advancedForm.create as any).mockResolvedValue({ id: "form-1", name: "Conditional", slug: "conditional", status: "DRAFT", fields: [{ id: "amount", name: "amount", type: "number", label: "Amount" }], pages: [], conditions: [], calculatedFields: [], settings: {} });
    await migrated.createConditionalForm("t1", { name: "Conditional", slug: "conditional" });
    expect(revisions.syncLegacyProjection).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "artifact-1", scope: { kind: "LIBRARY" }, source: expect.objectContaining({ kind: "ADVANCED_FORM" }) }));
  });

  it("createConditionalForm rejects duplicate slug", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue({ id: "form-1" });
    await expect(
      service.createConditionalForm("t1", { slug: "dup" }),
    ).rejects.toThrow();
  });

  it("updateAdvancedForm updates", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue({ id: "form-1" });
    const result = await service.updateAdvancedForm("t1", "form-1", {
      name: "U",
    });
    expect(result).toBeDefined();
  });

  it("deleteAdvancedForm deletes", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue({ id: "form-1" });
    const result = await service.deleteAdvancedForm("t1", "form-1");
    expect(result).toBeDefined();
  });

  it("addCalculatedField adds field", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue({
      id: "form-1",
      calculatedFields: [],
    });
    const result = await service.addCalculatedField("t1", "form-1", {
      name: "calc",
      formula: "a+b",
    });
    expect(result).toBeDefined();
  });

  it("addFormPage adds page", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue({
      id: "form-1",
      pages: [],
    });
    const result = await service.addFormPage("t1", "form-1", {
      title: "Page 1",
    });
    expect(result).toBeDefined();
  });

  it("getFormAnalytics returns analytics", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue({ id: "form-1" });
    const result = await service.getFormAnalytics("t1", "form-1");
    expect(Array.isArray(result)).toBe(true);
  });

  it("createFormVersion creates version", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue({
      id: "form-1",
      version: 1,
      fields: [],
      settings: {},
      conditions: [],
      pages: [],
    });
    const result = await service.createFormVersion("t1", "form-1", {});
    expect(result).toBeDefined();
  });

  it("getFormVersions returns versions", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue({ id: "form-1" });
    const result = await service.getFormVersions("t1", "form-1");
    expect(Array.isArray(result)).toBe(true);
  });

  it("previewForm returns form", async () => {
    const { prisma } = await import("@kannan19302/database");
    (prisma.advancedForm.findFirst as any).mockResolvedValue({ id: "form-1" });
    const result = await service.previewForm("t1", "form-1");
    expect(result).toBeDefined();
  });
});
