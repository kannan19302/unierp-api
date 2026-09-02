import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import {
  encryptConfigurationSecret,
  requirePublicHttpsUrl,
  testOidcConnection,
} from "@kannan19302/auth";

interface LegacySsoCreate {
  provider: string;
  clientId: string;
  clientSecret: string;
  issuerUrl?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  jwksUri?: string;
  scopes?: string[];
  domains?: string[];
  autoProvision?: boolean;
  defaultRole?: string;
  metadataUrl?: string;
  certificate?: string;
  enforced?: boolean;
}

type LegacySsoUpdate = Partial<LegacySsoCreate>;

/**
 * Compatibility adapter for the original `/saas/sso` surface.
 *
 * `SsoConfig` is the sole runtime federation record. The former
 * `TenantSsoConfig` path stored plaintext credentials and returned a synthetic
 * connection-test success; this adapter intentionally does neither.
 */
@Injectable()
export class SsoConfigService {
  private readonly supportedProviders = [
    { id: "google", name: "Google Workspace", type: "OIDC" },
    { id: "microsoft", name: "Microsoft Entra ID", type: "OIDC" },
    { id: "okta", name: "Okta", type: "OIDC" },
    { id: "auth0", name: "Auth0", type: "OIDC" },
    { id: "saml", name: "SAML 2.0", type: "SAML" },
    { id: "oidc", name: "OpenID Connect", type: "OIDC" },
    { id: "github", name: "GitHub", type: "OIDC" },
    { id: "gitlab", name: "GitLab", type: "OIDC" },
  ];

  async getSsoConfig(tenantId: string) {
    const config = await this.findTenantConfig(tenantId);
    return config ? toLegacyResponse(config) : null;
  }

  async createSsoConfig(tenantId: string, dto: LegacySsoCreate) {
    const existing = await this.findTenantConfig(tenantId);
    if (existing) {
      throw new BadRequestException("SSO config already exists for this tenant");
    }
    const providerType = providerFamily(dto.provider);
    if (providerType === "OIDC") assertOidcIssuer(dto.issuerUrl);
    const created = await prisma.ssoConfig.create({
      data: {
        tenantId,
        providerType,
        name: providerDisplayName(dto.provider),
        clientId: dto.clientId,
        clientSecret: encryptConfigurationSecret(dto.clientSecret),
        issuerUrl: dto.issuerUrl,
        authorizationUrl: dto.authorizeUrl,
        tokenUrl: dto.tokenUrl,
        userInfoUrl: dto.userInfoUrl,
        samlMetadataUrl: dto.metadataUrl,
        samlCert: dto.certificate,
        isActive: false,
        verificationStatus: "UNVERIFIED",
      },
    });
    return toLegacyResponse(created);
  }

  async updateSsoConfig(tenantId: string, dto: LegacySsoUpdate) {
    const config = await this.requireTenantConfig(tenantId);
    if (dto.provider && providerFamily(dto.provider) !== config.providerType) {
      throw new BadRequestException("Changing SSO protocol requires deleting and recreating the configuration.");
    }
    if (config.providerType === "OIDC" && dto.issuerUrl !== undefined) {
      assertOidcIssuer(dto.issuerUrl);
    }
    const updated = await prisma.ssoConfig.update({
      where: { tenantId_providerType: { tenantId, providerType: config.providerType } },
      data: {
        ...(dto.provider ? { name: providerDisplayName(dto.provider) } : {}),
        ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}),
        ...(dto.clientSecret !== undefined
          ? { clientSecret: encryptConfigurationSecret(dto.clientSecret) }
          : {}),
        ...(dto.issuerUrl !== undefined ? { issuerUrl: dto.issuerUrl } : {}),
        ...(dto.authorizeUrl !== undefined ? { authorizationUrl: dto.authorizeUrl } : {}),
        ...(dto.tokenUrl !== undefined ? { tokenUrl: dto.tokenUrl } : {}),
        ...(dto.userInfoUrl !== undefined ? { userInfoUrl: dto.userInfoUrl } : {}),
        ...(dto.metadataUrl !== undefined ? { samlMetadataUrl: dto.metadataUrl } : {}),
        ...(dto.certificate !== undefined ? { samlCert: dto.certificate } : {}),
        isActive: false,
        verificationStatus: "UNVERIFIED",
        lastVerifiedAt: null,
        lastVerifiedBy: null,
        lastVerificationError: null,
      },
    });
    return toLegacyResponse(updated);
  }

  async deleteSsoConfig(tenantId: string) {
    const config = await this.requireTenantConfig(tenantId);
    await prisma.ssoConfig.delete({
      where: { tenantId_providerType: { tenantId, providerType: config.providerType } },
    });
    return { success: true };
  }

  async toggleSso(tenantId: string) {
    const config = await this.requireTenantConfig(tenantId);
    if (!config.isActive && (config.verificationStatus !== "VERIFIED" || !config.lastVerifiedAt)) {
      throw new BadRequestException("SSO connection must pass verification before activation.");
    }
    const updated = await prisma.ssoConfig.update({
      where: { tenantId_providerType: { tenantId, providerType: config.providerType } },
      data: { isActive: !config.isActive },
    });
    return toLegacyResponse(updated);
  }

  async testSsoConnection(tenantId: string, verifiedBy: string) {
    const config = await this.requireTenantConfig(tenantId);
    if (config.providerType !== "OIDC") {
      throw new BadRequestException("SAML connection testing is not available on this compatibility endpoint.");
    }
    try {
      const evidence = await testOidcConnection(config.issuerUrl);
      const verified = await prisma.ssoConfig.update({
        where: { tenantId_providerType: { tenantId, providerType: config.providerType } },
        data: {
          verificationStatus: "VERIFIED",
          lastVerifiedAt: new Date(),
          lastVerifiedBy: verifiedBy,
          lastVerificationError: null,
        },
      });
      return { success: true, config: toLegacyResponse(verified), evidence };
    } catch {
      await prisma.ssoConfig.update({
        where: { tenantId_providerType: { tenantId, providerType: config.providerType } },
        data: {
          isActive: false,
          verificationStatus: "FAILED",
          lastVerifiedAt: null,
          lastVerifiedBy: verifiedBy,
          lastVerificationError: "OIDC_CONNECTION_TEST_FAILED",
        },
      });
      throw new BadRequestException("OIDC connection test failed.");
    }
  }

  async getSsoLoginUrl(tenantId: string) {
    const config = await this.requireTenantConfig(tenantId);
    if (!config.isActive || config.verificationStatus !== "VERIFIED" || !config.lastVerifiedAt) {
      throw new BadRequestException("SSO is not enabled for this tenant");
    }
    return {
      loginUrl: `/auth/sso/${tenantId}`,
      provider: config.providerType,
      issuerUrl: config.issuerUrl,
      authorizationUrl: config.authorizationUrl,
    };
  }

  async getSupportedProviders() {
    return this.supportedProviders;
  }

  private async findTenantConfig(tenantId: string) {
    const configs = await prisma.ssoConfig.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return configs.find((item) => item.providerType === "OIDC") ?? configs[0] ?? null;
  }

  private async requireTenantConfig(tenantId: string) {
    const config = await this.findTenantConfig(tenantId);
    if (!config) throw new NotFoundException("SSO config not found");
    return config;
  }
}

function providerFamily(value: string): "OIDC" | "SAML" {
  return value.toLowerCase() === "saml" ? "SAML" : "OIDC";
}

function providerDisplayName(value: string): string {
  return value.trim().slice(0, 255) || "Enterprise identity provider";
}

function assertOidcIssuer(value: string | undefined): void {
  try {
    requirePublicHttpsUrl(value, "OIDC issuer");
  } catch {
    throw new BadRequestException("An OIDC configuration requires a public HTTPS issuer URL.");
  }
}

function toLegacyResponse<T extends { clientSecret?: string | null; providerType: string; isActive: boolean }>(config: T) {
  const { clientSecret, ...safe } = config;
  return {
    ...safe,
    provider: config.providerType,
    isEnabled: config.isActive,
    hasClientSecret: Boolean(clientSecret),
  };
}
