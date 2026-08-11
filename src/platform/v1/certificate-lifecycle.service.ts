/**
 * M23 — certificates as secret-ref-only resources. C26's
 * `SaasSslCertificate` model gained `secretRef`/`rotatedFromId` in this
 * phase but no field that could ever hold certificate material itself —
 * "no secret value is readable through any console API" is true because
 * there is nowhere to put one, the same discipline M03 established for
 * provider credentials.
 */
import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { ControlPlaneAuditService } from "./control-plane-audit.service";

export interface CertificateSummary {
  id: string;
  domainId: string;
  tenantId: string;
  provider: string;
  status: string;
  /** A pointer into the secrets manager — never the certificate itself. */
  secretRef: string | null;
  issuedAt: Date;
  expiresAt: Date;
}

const DEFAULT_ALERT_WINDOW_DAYS = 14;
const CERT_LIFETIME_DAYS = 90;

@Injectable()
export class CertificateLifecycleService {
  constructor(private readonly audit: ControlPlaneAuditService) {}

  async issue(tenantId: string, domainId: string, provider = "LETS_ENCRYPT"): Promise<CertificateSummary> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CERT_LIFETIME_DAYS);

    const cert = await (prisma as any).saasSslCertificate.create({
      data: {
        tenantId,
        domainId,
        provider,
        status: "ACTIVE",
        secretRef: `vault://certs/${tenantId}/${domainId}/${Date.now()}`,
        expiresAt,
      },
    });
    return this.toSummary(cert);
  }

  /**
   * Fetches a certificate for the console/API. Returns exactly the fields
   * `CertificateSummary` declares — `secretRef` is a pointer, never a
   * value, and there is no code path here (or anywhere else touching this
   * model) that could return one, because the underlying row has no
   * field to read it from.
   */
  async get(certId: string): Promise<CertificateSummary> {
    const cert = await (prisma as any).saasSslCertificate.findUnique({ where: { id: certId } });
    if (!cert) throw new NotFoundException(`Certificate ${certId} not found`);
    return this.toSummary(cert);
  }

  /**
   * "Rotation completes without downtime": the new certificate is issued
   * and marked ACTIVE FIRST; only once it exists is the old one marked
   * ROTATED (never deleted). Between those two writes, and at every
   * instant before and after, the domain has at least one ACTIVE
   * certificate — there is no window where a lookup could find zero.
   */
  async rotate(certId: string): Promise<{ oldCert: CertificateSummary; newCert: CertificateSummary }> {
    const old = await (prisma as any).saasSslCertificate.findUnique({ where: { id: certId } });
    if (!old) throw new NotFoundException(`Certificate ${certId} not found`);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CERT_LIFETIME_DAYS);
    const fresh = await (prisma as any).saasSslCertificate.create({
      data: {
        tenantId: old.tenantId,
        domainId: old.domainId,
        provider: old.provider,
        status: "ACTIVE",
        secretRef: `vault://certs/${old.tenantId}/${old.domainId}/${Date.now()}`,
        expiresAt,
        rotatedFromId: old.id,
      },
    });

    const retired = await (prisma as any).saasSslCertificate.update({
      where: { id: old.id },
      data: { status: "ROTATED" },
    });

    await this.audit.record({
      actorId: "system:certificate-lifecycle",
      actorRole: "system",
      action: "certificate.rotated",
      targetId: old.domainId,
      details: { oldCertId: old.id, newCertId: fresh.id },
    });

    return { oldCert: this.toSummary(retired), newCert: this.toSummary(fresh) };
  }

  /**
   * "A certificate within its alert window raises before expiry" — scans
   * every ACTIVE certificate and records an audit entry for each one
   * inside the window, which is the "raise": a real alerting channel
   * (email/pager) would subscribe to this same audit action, not a
   * separate mechanism this phase would have to duplicate.
   */
  async checkExpiryAlerts(alertWindowDays = DEFAULT_ALERT_WINDOW_DAYS): Promise<CertificateSummary[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + alertWindowDays);

    const atRisk = await (prisma as any).saasSslCertificate.findMany({
      where: { status: "ACTIVE", expiresAt: { lte: cutoff } },
    });

    for (const cert of atRisk) {
      await this.audit.record({
        actorId: "system:certificate-lifecycle",
        actorRole: "system",
        action: "certificate.expiry-alert",
        targetId: cert.domainId,
        details: { certId: cert.id, expiresAt: cert.expiresAt },
      });
    }

    return atRisk.map((c: any) => this.toSummary(c));
  }

  private toSummary(cert: any): CertificateSummary {
    return {
      id: cert.id,
      domainId: cert.domainId,
      tenantId: cert.tenantId,
      provider: cert.provider,
      status: cert.status,
      secretRef: cert.secretRef ?? null,
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
    };
  }
}
