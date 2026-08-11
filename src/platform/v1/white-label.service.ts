import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { DnsService } from "../provider-registry/dns.service";

@Injectable()
export class SaasWhiteLabelDeepService {
  // M22: DNS provisioning goes through the shared multi-provider surface —
  // never a second, duplicated DNS implementation living in C26.
  constructor(private readonly dns: DnsService) {}

  async getDomains(tenantId: string) {
    return prisma.saasWhiteLabelDomain.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * M22: the verification TXT record this domain needs is provisioned
   * through DnsService.manageRecord() — the platform's one multi-provider
   * DNS surface. This method never imports a DNS adapter, never branches
   * on a provider name; whichever provider M06 routes to is what serves
   * it, provably (see dns.service.spec.ts's own test that removes one
   * registered implementation and confirms this exact call still works).
   */
  async addCustomDomain(
    tenantId: string,
    dto: { customDomain: string; brandingConfig?: any },
  ) {
    const verificationToken = `TOKEN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

    await this.dns.manageRecord(tenantId, {
      zoneName: dto.customDomain,
      recordType: "TXT",
      name: `_unierp-verify.${dto.customDomain}`,
      value: verificationToken,
    });

    return prisma.saasWhiteLabelDomain.create({
      data: {
        tenantId,
        customDomain: dto.customDomain,
        verificationToken,
        brandingConfig: dto.brandingConfig || null,
      },
    });
  }

  async verifyDomain(tenantId: string, id: string) {
    const domain = await prisma.saasWhiteLabelDomain.findFirst({
      where: { id, tenantId },
    });
    if (!domain) throw new NotFoundException("Custom domain not found");

    return prisma.saasWhiteLabelDomain.update({
      where: { id },
      data: {
        isVerified: true,
        status: "ACTIVE",
      },
    });
  }

  async issueSslCert(tenantId: string, domainId: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    return prisma.saasSslCertificate.create({
      data: {
        tenantId,
        domainId,
        provider: "LETS_ENCRYPT",
        status: "ACTIVE",
        expiresAt,
        autoRenew: true,
      },
    });
  }
}
