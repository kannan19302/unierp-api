import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { SaasPortalSecurityService } from "../services/security.service";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  encryptConfigurationSecret: vi.fn((value: string) => `enc:v1:synthetic:${value.length}`),
  testOidcConnection: vi.fn(),
}));

vi.mock("@kannan19302/database", () => ({
  prisma: {
    ssoConfig: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
    },
  },
  idpClient: {},
}));

vi.mock("@/common/idp-client", () => ({ idpClient: {} }));
vi.mock("@kannan19302/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kannan19302/auth")>()),
  encryptConfigurationSecret: mocks.encryptConfigurationSecret,
  testOidcConnection: mocks.testOidcConnection,
}));
vi.mock("@kannan19302/shared", () => ({ hasPermission: vi.fn() }));

describe("SaasPortalSecurityService canonical SSO configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ id: "sso-a" });
    mocks.update.mockResolvedValue({
      id: "sso-a",
      clientSecret: "enc:v1:not-returned",
      verificationStatus: "VERIFIED",
      lastVerifiedAt: new Date("2026-08-29T00:00:00.000Z"),
      isActive: false,
    });
  });

  it("redacts the encrypted client secret from admin reads", async () => {
    mocks.findMany.mockResolvedValue([{ id: "sso-a", clientSecret: "enc:v1:not-returned", name: "Acme IdP" }]);
    const result = await new SaasPortalSecurityService().getSsoConfigs("tenant-a");
    expect(result).toEqual([{ id: "sso-a", name: "Acme IdP", hasClientSecret: true }]);
    expect(result[0]).not.toHaveProperty("clientSecret");
  });

  it("encrypts a supplied secret before persistence", async () => {
    await new SaasPortalSecurityService().saveSsoConfig("tenant-a", {
      providerType: "OIDC",
      name: "Acme IdP",
      issuerUrl: "https://login.example.test/tenant-a",
      clientId: "client-a",
      clientSecret: "synthetic-client-secret",
      isActive: true,
    });
    expect(mocks.encryptConfigurationSecret).toHaveBeenCalledWith("synthetic-client-secret");
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        clientSecret: "enc:v1:synthetic:23",
        isActive: false,
        verificationStatus: "UNVERIFIED",
      }),
      create: expect.objectContaining({
        clientSecret: "enc:v1:synthetic:23",
        isActive: false,
        verificationStatus: "UNVERIFIED",
      }),
    }));
  });

  it("preserves the stored secret when an update omits it", async () => {
    await new SaasPortalSecurityService().saveSsoConfig("tenant-a", {
      providerType: "OIDC",
      name: "Acme IdP",
      issuerUrl: "https://login.example.test/tenant-a",
      clientId: "client-a",
      isActive: true,
    });
    const call = mocks.upsert.mock.calls[0]?.[0];
    expect(call.update).not.toHaveProperty("clientSecret");
    expect(call.create).not.toHaveProperty("clientSecret");
  });

  it("rejects activation with an unsafe issuer before persistence", async () => {
    await expect(new SaasPortalSecurityService().saveSsoConfig("tenant-a", {
      providerType: "OIDC",
      name: "Unsafe IdP",
      issuerUrl: "http://169.254.169.254/metadata",
      isActive: true,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("records successful OIDC connection verification without returning key material", async () => {
    mocks.findUnique.mockResolvedValue({
      issuerUrl: "https://login.example.test/tenant-a",
      verificationStatus: "UNVERIFIED",
      lastVerifiedAt: null,
      clientSecret: "enc:v1:not-returned",
    });
    mocks.testOidcConnection.mockResolvedValue({
      issuer: "https://login.example.test/tenant-a",
      algorithms: ["RS256"],
      signingKeyCount: 2,
    });
    const result = await new SaasPortalSecurityService().testSsoConnection("tenant-a", "oidc", "user-a");
    expect(result).toMatchObject({ success: true, evidence: { signingKeyCount: 2 } });
    expect(result.config).not.toHaveProperty("clientSecret");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ verificationStatus: "VERIFIED", lastVerifiedBy: "user-a" }),
    }));
  });

  it("records a safe failed status and refuses false success", async () => {
    mocks.findUnique.mockResolvedValue({ issuerUrl: "https://login.example.test/tenant-a" });
    mocks.testOidcConnection.mockRejectedValue(new Error("synthetic upstream failure"));
    await expect(new SaasPortalSecurityService().testSsoConnection("tenant-a", "OIDC", "user-a"))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        isActive: false,
        verificationStatus: "FAILED",
        lastVerificationError: "OIDC_CONNECTION_TEST_FAILED",
      }),
    }));
  });

  it("denies activation until current verification evidence exists", async () => {
    mocks.findUnique.mockResolvedValue({ verificationStatus: "UNVERIFIED", lastVerifiedAt: null });
    await expect(new SaasPortalSecurityService().setSsoActivation("tenant-a", "OIDC", true))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
