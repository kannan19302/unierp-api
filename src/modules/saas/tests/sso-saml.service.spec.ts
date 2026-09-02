import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { SaasPortalSsoSamlDeepService } from "../services/sso-saml.service";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@kannan19302/database", () => ({
  prisma: {
    ssoConfig: {
      findMany: mocks.findMany,
      upsert: mocks.upsert,
    },
  },
}));

describe("SaaS portal SAML compatibility surface", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the canonical SsoConfig store instead of returning sample data", async () => {
    mocks.findMany.mockResolvedValue([]);
    await expect(new SaasPortalSsoSamlDeepService().getSsoConfigs("tenant-a"))
      .resolves.toEqual([]);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", providerType: "SAML" },
    });
  });

  it("persists new SAML settings inactive and unverified", async () => {
    mocks.upsert.mockImplementation(async ({ create }) => ({ id: "sso-a", ...create }));
    const result = await new SaasPortalSsoSamlDeepService().configureSso("tenant-a", {
      provider: "Enterprise SAML",
      issuerUrl: "urn:synthetic:idp",
      ssoUrl: "https://login.example.test/saml",
      certificate: "synthetic-public-certificate",
    });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        providerType: "SAML",
        isActive: false,
        verificationStatus: "UNVERIFIED",
      }),
    }));
    expect(result).toMatchObject({ isEnabled: false, verificationStatus: "UNVERIFIED" });
  });

  it("rejects local or insecure assertion endpoints", async () => {
    await expect(new SaasPortalSsoSamlDeepService().configureSso("tenant-a", {
      ssoUrl: "http://127.0.0.1/saml",
      certificate: "synthetic-public-certificate",
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
