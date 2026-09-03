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
  testSamlConfiguration: vi.fn(),
  auditCreate: vi.fn().mockResolvedValue({ id: "audit-1" }),
}));

vi.mock("@kannan19302/database", () => ({
  prisma: {
    ssoConfig: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
    },
    auditLog: {
      create: mocks.auditCreate,
    },
  },
  idpClient: {},
}));

vi.mock("@/common/idp-client", () => ({ idpClient: {} }));
vi.mock("@kannan19302/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kannan19302/auth")>()),
  encryptConfigurationSecret: mocks.encryptConfigurationSecret,
  testOidcConnection: mocks.testOidcConnection,
  testSamlConfiguration: mocks.testSamlConfiguration,
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

  it("records successful SAML connection verification and emits audit log", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "sso-saml-1",
      samlEntryPoint: "https://idp.example.test/sso/saml",
      samlCert: "-----BEGIN CERTIFICATE-----\nsynthetic-cert\n-----END CERTIFICATE-----",
      samlIssuer: "unierp-tenant-a",
      verificationStatus: "UNVERIFIED",
      lastVerifiedAt: null,
    });
    mocks.testSamlConfiguration.mockReturnValue({
      entryPoint: "https://idp.example.test/sso/saml",
      issuer: "unierp-tenant-a",
      certificateSubject: "CN=idp.example.test",
      validTo: "2027-09-03",
      fingerprint256: "AA:BB:CC",
      keyAlgorithm: "rsa",
    });

    const result = await new SaasPortalSecurityService().testSsoConnection("tenant-a", "SAML", "user-a");
    expect(result).toMatchObject({ success: true, evidence: { fingerprint256: "AA:BB:CC" } });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ verificationStatus: "VERIFIED", lastVerifiedBy: "user-a" }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "SSO_CONNECTION_TEST_SUCCESS",
        userId: "user-a",
        changes: expect.objectContaining({ providerType: "SAML" }),
      }),
    }));
  });

  it("records safe failed SAML status on verification error", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "sso-saml-1",
      samlEntryPoint: "https://idp.example.test/sso/saml",
      samlCert: "invalid-cert",
    });
    mocks.testSamlConfiguration.mockImplementation(() => {
      throw new Error("Invalid certificate");
    });

    await expect(new SaasPortalSecurityService().testSsoConnection("tenant-a", "SAML", "user-a"))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        isActive: false,
        verificationStatus: "FAILED",
        lastVerificationError: "SAML_CONNECTION_TEST_FAILED",
      }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "SSO_CONNECTION_TEST_FAILED",
        userId: "user-a",
        changes: expect.objectContaining({ providerType: "SAML" }),
      }),
    }));
  });

  it("emits audit event when an active SSO configuration is activated or deactivated", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "sso-saml-1",
      verificationStatus: "VERIFIED",
      lastVerifiedAt: new Date(),
    });

    await new SaasPortalSecurityService().setSsoActivation("tenant-a", "SAML", true, "admin-user");
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "SSO_CONFIG_ACTIVATED",
        userId: "admin-user",
        changes: expect.objectContaining({ providerType: "SAML", isActive: true }),
      }),
    }));
  });
});

