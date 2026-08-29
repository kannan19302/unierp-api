import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { requirePublicHttpsUrl } from "@kannan19302/auth";

@Injectable()
export class SaasPortalSsoSamlDeepService {
  async getSsoConfigs(tenantId: string) {
    const configs = await prisma.ssoConfig.findMany({
      where: { tenantId, providerType: "SAML" },
    });
    return configs.map(toCompatibilityResponse);
  }

  async configureSso(tenantId: string, dto: any) {
    const entryPoint = publicHttps(dto.ssoUrl, "SAML entry point");
    const metadataUrl = dto.metadataUrl
      ? publicHttps(dto.metadataUrl, "SAML metadata URL")
      : undefined;
    if (!dto.certificate || typeof dto.certificate !== "string") {
      throw new BadRequestException("A SAML signing certificate is required.");
    }
    const config = await prisma.ssoConfig.upsert({
      where: { tenantId_providerType: { tenantId, providerType: "SAML" } },
      update: {
        name: String(dto.provider || "SAML_GENERIC").slice(0, 255),
        samlIssuer: dto.issuerUrl ? String(dto.issuerUrl) : null,
        samlEntryPoint: entryPoint,
        samlMetadataUrl: metadataUrl,
        samlCert: dto.certificate,
        isActive: false,
        verificationStatus: "UNVERIFIED",
        lastVerifiedAt: null,
        lastVerifiedBy: null,
        lastVerificationError: null,
      },
      create: {
        tenantId,
        providerType: "SAML",
        name: String(dto.provider || "SAML_GENERIC").slice(0, 255),
        samlIssuer: dto.issuerUrl ? String(dto.issuerUrl) : null,
        samlEntryPoint: entryPoint,
        samlMetadataUrl: metadataUrl,
        samlCert: dto.certificate,
        isActive: false,
        verificationStatus: "UNVERIFIED",
      },
    });
    return toCompatibilityResponse(config);
  }
}

function publicHttps(value: unknown, label: string): string {
  try {
    return requirePublicHttpsUrl(typeof value === "string" ? value : undefined, label).toString();
  } catch {
    throw new BadRequestException(`${label} must be a public HTTPS URL.`);
  }
}

function toCompatibilityResponse(config: {
  id: string;
  tenantId: string;
  name: string;
  samlIssuer: string | null;
  samlEntryPoint: string | null;
  isActive: boolean;
  verificationStatus: string;
  lastVerifiedAt: Date | null;
}) {
  return {
    id: config.id,
    tenantId: config.tenantId,
    provider: config.name,
    issuerUrl: config.samlIssuer,
    ssoUrl: config.samlEntryPoint,
    isEnabled: config.isActive,
    enforceSso: false,
    verificationStatus: config.verificationStatus,
    lastVerifiedAt: config.lastVerifiedAt,
  };
}
