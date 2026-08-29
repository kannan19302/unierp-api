import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { SsoConfigService } from "../sso-config.service";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  encrypt: vi.fn((value: string) => `enc:v1:synthetic:${value.length}`),
  testOidc: vi.fn(),
}));

vi.mock("@kannan19302/database", () => ({
  prisma: {
    ssoConfig: {
      findMany: mocks.findMany,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete,
    },
  },
}));

vi.mock("@kannan19302/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kannan19302/auth")>()),
  encryptConfigurationSecret: mocks.encrypt,
  testOidcConnection: mocks.testOidc,
}));

describe("legacy SaaS SSO compatibility adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.create.mockImplementation(async ({ data }) => ({ id: "sso-a", ...data }));
    mocks.update.mockImplementation(async ({ data }) => ({
      id: "sso-a",
      tenantId: "tenant-a",
      providerType: "OIDC",
      isActive: false,
      clientSecret: "enc:v1:hidden",
      ...data,
    }));
  });

  it("writes only the canonical SsoConfig record with an encrypted secret", async () => {
    const result = await new SsoConfigService().createSsoConfig("tenant-a", {
      provider: "oidc",
      clientId: "client-a",
      clientSecret: "synthetic-client-secret",
      issuerUrl: "https://login.example.test/tenant-a",
    });
    expect(mocks.encrypt).toHaveBeenCalledWith("synthetic-client-secret");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerType: "OIDC",
        clientSecret: "enc:v1:synthetic:23",
        isActive: false,
        verificationStatus: "UNVERIFIED",
      }),
    }));
    expect(result).not.toHaveProperty("clientSecret");
    expect(result).toMatchObject({ hasClientSecret: true, isEnabled: false });
  });

  it("uses the real discovery and JWKS test rather than synthetic success", async () => {
    mocks.findMany.mockResolvedValue([{
      tenantId: "tenant-a",
      providerType: "OIDC",
      issuerUrl: "https://login.example.test/tenant-a",
      clientSecret: "enc:v1:hidden",
      isActive: false,
      verificationStatus: "UNVERIFIED",
      lastVerifiedAt: null,
      createdAt: new Date(),
    }]);
    mocks.testOidc.mockResolvedValue({ signingKeyCount: 2, algorithms: ["RS256"] });
    await expect(new SsoConfigService().testSsoConnection("tenant-a", "user-a"))
      .resolves.toMatchObject({ success: true, evidence: { signingKeyCount: 2 } });
    expect(mocks.testOidc).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ verificationStatus: "VERIFIED", lastVerifiedBy: "user-a" }),
    }));
  });

  it("records safe failure and never returns a false-positive test result", async () => {
    mocks.findMany.mockResolvedValue([{
      tenantId: "tenant-a",
      providerType: "OIDC",
      issuerUrl: "https://login.example.test/tenant-a",
      isActive: true,
      verificationStatus: "VERIFIED",
      lastVerifiedAt: new Date(),
      createdAt: new Date(),
    }]);
    mocks.testOidc.mockRejectedValue(new Error("synthetic upstream failure"));
    await expect(new SsoConfigService().testSsoConnection("tenant-a", "user-a"))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        isActive: false,
        verificationStatus: "FAILED",
        lastVerificationError: "OIDC_CONNECTION_TEST_FAILED",
      }),
    }));
  });

  it("denies activation without current verification evidence", async () => {
    mocks.findMany.mockResolvedValue([{
      tenantId: "tenant-a",
      providerType: "OIDC",
      isActive: false,
      verificationStatus: "UNVERIFIED",
      lastVerifiedAt: null,
      createdAt: new Date(),
    }]);
    await expect(new SsoConfigService().toggleSso("tenant-a"))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
