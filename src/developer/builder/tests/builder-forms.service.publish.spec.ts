import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@kannan19302/database";
import { BuilderFormsService } from "../builder-forms.service";

vi.mock("@kannan19302/database", () => {
  const mock = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  });
  return {
    prisma: {
      builderForm: mock(),
      schemaRegistry: mock(),
      pageRegistry: mock(),
    },
  };
});

/**
 * G10 — `publishBuilderForm` is the bridge from a Form Builder edit (real
 * source of truth: BuilderForm.pages/conditions) to what the tenant-facing
 * renderer actually reads (PageRegistry.layout). A form built with steps and
 * conditional logic that published WITHOUT them would render correctly in
 * the builder and silently flatten to a single page with no logic for the
 * end user — this is the one point in the pipeline where that regression
 * would need to be introduced, so it's the one point that gets a real test.
 */
describe("BuilderFormsService.publishBuilderForm — G10 pages/conditions passthrough", () => {
  let service: BuilderFormsService;

  beforeEach(() => {
    service = new BuilderFormsService();
    vi.clearAllMocks();
  });

  it("carries pages and conditions into the PageRegistry layout on first publish", async () => {
    const form = {
      id: "form1",
      tenantId: "t1",
      slug: "onboarding",
      name: "Onboarding",
      module: "hr",
      fields: [
        { id: "f1", name: "plan", type: "Select", required: true },
        { id: "f2", name: "seats", type: "Int", required: false },
      ],
      pages: [
        { id: "p1", title: "Plan", order: 0, fieldIds: ["plan"] },
        { id: "p2", title: "Team", order: 1, fieldIds: ["seats"] },
      ],
      conditions: [
        {
          fieldId: "plan",
          operator: "notEquals",
          value: "enterprise",
          action: "hide",
          targetFieldId: "seats",
        },
      ],
      settings: {},
    };

    (prisma.builderForm.findFirst as any).mockResolvedValue(form);
    (prisma.schemaRegistry.findFirst as any).mockResolvedValue(null);
    (prisma.schemaRegistry.create as any).mockResolvedValue({ id: "schema1" });
    (prisma.pageRegistry.findFirst as any).mockResolvedValue(null);
    (prisma.pageRegistry.create as any).mockImplementation(
      async ({ data }: any) => ({ id: "page1", ...data }),
    );
    (prisma.builderForm.update as any).mockResolvedValue({
      ...form,
      status: "PUBLISHED",
    });

    const result = await service.publishBuilderForm("t1", "form1");

    expect(prisma.pageRegistry.create).toHaveBeenCalledTimes(1);
    const createCall = (prisma.pageRegistry.create as any).mock.calls[0][0];
    expect(createCall.data.layout.fields).toEqual(form.fields);
    expect(createCall.data.layout.pages).toEqual(form.pages);
    expect(createCall.data.layout.conditions).toEqual(form.conditions);
    expect(result.page.layout.pages).toHaveLength(2);
    expect(result.page.layout.conditions).toHaveLength(1);
  });

  it("carries pages and conditions on re-publish (existing page update path)", async () => {
    const form = {
      id: "form1",
      tenantId: "t1",
      slug: "onboarding",
      name: "Onboarding",
      module: "hr",
      fields: [{ id: "f1", name: "plan", type: "Select", required: true }],
      pages: [{ id: "p1", title: "Plan", order: 0, fieldIds: ["plan"] }],
      conditions: [],
      settings: {},
    };

    (prisma.builderForm.findFirst as any).mockResolvedValue(form);
    (prisma.schemaRegistry.findFirst as any).mockResolvedValue({ id: "schema1" });
    (prisma.schemaRegistry.update as any).mockResolvedValue({ id: "schema1" });
    (prisma.pageRegistry.findFirst as any).mockResolvedValue({ id: "page1" });
    (prisma.pageRegistry.update as any).mockImplementation(
      async ({ data }: any) => ({ id: "page1", ...data }),
    );
    (prisma.builderForm.update as any).mockResolvedValue({
      ...form,
      status: "PUBLISHED",
    });

    await service.publishBuilderForm("t1", "form1");

    const updateCall = (prisma.pageRegistry.update as any).mock.calls[0][0];
    expect(updateCall.data.layout.pages).toEqual(form.pages);
    expect(updateCall.data.layout.conditions).toEqual(form.conditions);
  });

  it("defaults to empty pages/conditions for a form that predates G10", async () => {
    const form = {
      id: "form1",
      tenantId: "t1",
      slug: "legacy",
      name: "Legacy Form",
      module: "hr",
      fields: [{ id: "f1", name: "note", type: "Text" }],
      pages: undefined,
      conditions: undefined,
      settings: {},
    };

    (prisma.builderForm.findFirst as any).mockResolvedValue(form);
    (prisma.schemaRegistry.findFirst as any).mockResolvedValue(null);
    (prisma.schemaRegistry.create as any).mockResolvedValue({ id: "schema1" });
    (prisma.pageRegistry.findFirst as any).mockResolvedValue(null);
    (prisma.pageRegistry.create as any).mockImplementation(
      async ({ data }: any) => ({ id: "page1", ...data }),
    );
    (prisma.builderForm.update as any).mockResolvedValue({
      ...form,
      status: "PUBLISHED",
    });

    await service.publishBuilderForm("t1", "form1");

    const createCall = (prisma.pageRegistry.create as any).mock.calls[0][0];
    expect(createCall.data.layout.pages).toEqual([]);
    expect(createCall.data.layout.conditions).toEqual([]);
  });
});
