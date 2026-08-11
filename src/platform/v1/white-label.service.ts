import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { DnsService } from "../provider-registry/dns.service";
import { CertificateLifecycleService } from "./certificate-lifecycle.service";

@Injectable()
export class SaasWhiteLabelDeepService {
  // M22: DNS provisioning goes through the shared multi-provider surface —
  // never a second, duplicated DNS implementation living in C26.
  // M23: certificate issuance goes through the shared secret-ref-only
  // lifecycle service — never a second, duplicated cert model in C26.
  constructor(
    private readonly dns: DnsService,
    private readonly certificates: CertificateLifecycleService,
  ) {}

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

  /** M23: this call is the ENTIRE implementation — issuance, expiry and
   *  the secret-ref discipline all live in CertificateLifecycleService,
   *  never duplicated here. */
  async issueSslCert(tenantId: string, domainId: string) {
    return this.certificates.issue(tenantId, domainId, "LETS_ENCRYPT");
  }
}
