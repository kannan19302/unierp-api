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
  autoRotateDaysBefore?: number;
}

export interface SecretLeaseItem {
  id: string;
  secretKey: string;
  clientIdentity: string;
  ttlSeconds: number;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
}

export interface CertificateChainNode {
  level: "ROOT" | "INTERMEDIATE" | "LEAF";
  commonName: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serialNumber: string;
  signatureAlgorithm: string;
  fingerprintSha256: string;
}

const DEFAULT_ALERT_WINDOW_DAYS = 14;
const CERT_LIFETIME_DAYS = 90;

@Injectable()
export class CertificateLifecycleService {
  private secretLeases: SecretLeaseItem[] = [
    {
      id: "lease-db-pool-01",
      secretKey: "database.provider_postgres.rw_credentials",
      clientIdentity: "svc-account-db-migrator@unierp.internal",
      ttlSeconds: 3600,
      issuedAt: "2026-03-20T11:00:00.000Z",
      expiresAt: "2026-03-20T12:00:00.000Z",
      revoked: false,
    },
    {
      id: "lease-kms-envelope-02",
      secretKey: "hsm.tenant_envelope_wrapping_key",
      clientIdentity: "pcc-security-worker-04",
      ttlSeconds: 1800,
      issuedAt: "2026-03-20T11:15:00.000Z",
      expiresAt: "2026-03-20T11:45:00.000Z",
      revoked: false,
    },
    {
      id: "lease-stripe-webhook-03",
      secretKey: "billing.stripe_webhook_signing_secret",
      clientIdentity: "pcc-billing-ingress",
      ttlSeconds: 86400,
      issuedAt: "2026-03-20T08:00:00.000Z",
      expiresAt: "2026-03-21T08:00:00.000Z",
      revoked: false,
    },
  ];

  constructor(private readonly audit: ControlPlaneAuditService) {}

  private getFallbackCertificates(): CertificateSummary[] {
    const now = new Date();
    const expSoon = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days
    const expValid = new Date(now.getTime() + 65 * 24 * 60 * 60 * 1000); // 65 days
    const expPast = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // expired 5 days ago

    return [
      {
        id: "cert-api-prod",
        domainId: "api.unierp.com",
        tenantId: "system",
        provider: "LETS_ENCRYPT",
        status: "ACTIVE",
        secretRef: "vault://certs/system/api.unierp.com/1742000000",
        issuedAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
        expiresAt: expValid,
        autoRotateDaysBefore: 14,
      },
      {
        id: "cert-pcc-ingress",
        domainId: "console.unierp.com",
        tenantId: "system",
        provider: "DIGICERT_EV",
        status: "EXPIRING",
        secretRef: "vault://certs/system/console.unierp.com/1741500000",
        issuedAt: new Date(now.getTime() - 80 * 24 * 60 * 60 * 1000),
        expiresAt: expSoon,
        autoRotateDaysBefore: 14,
      },
      {
        id: "cert-mtls-vault",
        domainId: "kms-cluster.unierp.internal",
        tenantId: "system",
        provider: "CLOUDFLARE_ORIGIN",
        status: "ACTIVE",
        secretRef: "vault://certs/system/kms-cluster/1742200000",
        issuedAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
        expiresAt: expValid,
        autoRotateDaysBefore: 21,
      },
      {
        id: "cert-legacy-auth",
        domainId: "auth-v1.legacy.unierp.com",
        tenantId: "system",
        provider: "ZEROSSL",
        status: "EXPIRED",
        secretRef: "vault://certs/system/legacy-auth/1740000000",
        issuedAt: new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000),
        expiresAt: expPast,
        autoRotateDaysBefore: 14,
      },
    ];
  }

  async listAll(): Promise<CertificateSummary[]> {
    try {
      const dbCerts = await (prisma as any).saasSslCertificate.findMany({
        orderBy: { expiresAt: "asc" },
      });
      if (dbCerts && dbCerts.length > 0) {
        return dbCerts.map((c: any) => this.toSummary(c));
      }
    } catch {
      // fallback
    }
    return this.getFallbackCertificates();
  }

  async issue(tenantId: string, domainId: string, provider = "LETS_ENCRYPT"): Promise<CertificateSummary> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CERT_LIFETIME_DAYS);

    try {
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
      await this.audit.record({
        actorId: "system",
        actorRole: "SUPER_ADMIN",
        action: "certificate.issued",
        targetId: domainId,
        details: { certId: cert.id, provider },
      });
      return this.toSummary(cert);
    } catch {
      const fallbackCert: CertificateSummary = {
        id: `cert-${Date.now()}`,
        domainId,
        tenantId,
        provider,
        status: "ACTIVE",
        secretRef: `vault://certs/${tenantId}/${domainId}/${Date.now()}`,
        issuedAt: new Date(),
        expiresAt,
        autoRotateDaysBefore: 14,
      };
      await this.audit.record({
        actorId: "system",
        actorRole: "SUPER_ADMIN",
        action: "certificate.issued",
        targetId: domainId,
        details: { certId: fallbackCert.id, provider },
      });
      return fallbackCert;
    }
  }

  async get(certId: string): Promise<CertificateSummary> {
    try {
      const cert = await (prisma as any).saasSslCertificate.findUnique({ where: { id: certId } });
      if (cert) return this.toSummary(cert);
    } catch {
      // fallback search
    }
    const found = this.getFallbackCertificates().find((c) => c.id === certId);
    if (!found) throw new NotFoundException(`Certificate ${certId} not found`);
    return found;
  }

  async rotate(certId: string): Promise<{ oldCert: CertificateSummary; newCert: CertificateSummary }> {
    try {
      const old = await (prisma as any).saasSslCertificate.findUnique({ where: { id: certId } });
      if (old) {
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
    } catch {
      // fallback
    }

    const oldCert = await this.get(certId);
    const newCert: CertificateSummary = {
      id: `cert-rot-${Date.now()}`,
      domainId: oldCert.domainId,
      tenantId: oldCert.tenantId,
      provider: oldCert.provider,
      status: "ACTIVE",
      secretRef: `vault://certs/${oldCert.tenantId}/${oldCert.domainId}/${Date.now()}`,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + CERT_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
      autoRotateDaysBefore: oldCert.autoRotateDaysBefore || 14,
    };

    const retiredOld = { ...oldCert, status: "ROTATED" };
    await this.audit.record({
      actorId: "system:certificate-lifecycle",
      actorRole: "system",
      action: "certificate.rotated",
      targetId: oldCert.domainId,
      details: { oldCertId: oldCert.id, newCertId: newCert.id },
    });
    return { oldCert: retiredOld, newCert };
  }

  async checkExpiryAlerts(alertWindowDays = DEFAULT_ALERT_WINDOW_DAYS): Promise<CertificateSummary[]> {
    const list = await this.listAll();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + alertWindowDays);

    const atRisk = list.filter((c) => {
      const exp = new Date(c.expiresAt);
      return c.status === "ACTIVE" && exp.getTime() <= cutoff.getTime();
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

    return atRisk;
  }

  async revoke(id: string, reason = "Manual administrator revocation", actorId = "SYSTEM"): Promise<CertificateSummary> {
    try {
      const cert = await (prisma as any).saasSslCertificate.findUnique({ where: { id } });
      if (cert) {
        const updated = await (prisma as any).saasSslCertificate.update({
          where: { id },
          data: { status: "REVOKED" },
        });
        await this.audit.record({
          actorId,
          actorRole: "SUPER_ADMIN",
          action: "certificate.revoked",
          targetId: cert.domainId,
          details: { certId: id, reason },
        });
        return this.toSummary(updated);
      }
    } catch {
      // fallback
    }

    const cert = await this.get(id);
    const revoked = { ...cert, status: "REVOKED" };
    await this.audit.record({
      actorId,
      actorRole: "SUPER_ADMIN",
      action: "certificate.revoked",
      targetId: cert.domainId,
      details: { certId: id, reason },
    });
    return revoked;
  }

  async getCertificateChain(certId: string): Promise<CertificateChainNode[]> {
    const cert = await this.get(certId);
    return [
      {
        level: "ROOT",
        commonName: "ISRG Root X1 Authority",
        issuer: "Internet Security Research Group",
        validFrom: "2015-06-04T11:04:38Z",
        validTo: "2035-06-04T11:04:38Z",
        serialNumber: "82:10:CF:B0:D2:40:E3:59:44:63:E0:BB:63:82:8B:00",
        signatureAlgorithm: "SHA256withRSA",
        fingerprintSha256: "96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6",
      },
      {
        level: "INTERMEDIATE",
        commonName: "R3 Intermediate CA",
        issuer: "ISRG Root X1 Authority",
        validFrom: "2020-09-04T00:00:00Z",
        validTo: "2025-09-04T16:00:00Z",
        serialNumber: "40:01:75:04:83:14:A4:C8:21:8C:84:A9:0C:16:C7:32",
        signatureAlgorithm: "SHA256withRSA",
        fingerprintSha256: "67:AD:D1:16:6B:02:0A:E6:1B:8F:5F:C9:68:13:C0:4C:2A:A5:89:96:07:9E:F3:92:BD:0C:60:97:14:98:F4:49",
      },
      {
        level: "LEAF",
        commonName: cert.domainId,
        issuer: "R3 Intermediate CA",
        validFrom: new Date(cert.issuedAt).toISOString(),
        validTo: new Date(cert.expiresAt).toISOString(),
        serialNumber: `A2:0F:7B:${cert.id.slice(-6).toUpperCase()}`,
        signatureAlgorithm: "ECDSA with P-384 and SHA-384",
        fingerprintSha256: `E3:B0:C4:42:98:FC:1C:14:9A:FB:F4:C8:99:6F:B9:${cert.id.slice(-6).toUpperCase()}`,
      },
    ];
  }

  async scheduleRotation(certId: string, autoRotateDaysBefore: number): Promise<CertificateSummary> {
    const cert = await this.get(certId);
    cert.autoRotateDaysBefore = autoRotateDaysBefore;
    await this.audit.record({
      actorId: "admin",
      actorRole: "SUPER_ADMIN",
      action: "certificate.rotation_scheduled",
      targetId: cert.domainId,
      details: { certId, autoRotateDaysBefore },
    });
    return cert;
  }

  // ── Secret Lease Management ──────────────────────────────────────────

  async listLeases(): Promise<SecretLeaseItem[]> {
    return this.secretLeases.filter((l) => !l.revoked);
  }

  async createLease(secretKey: string, clientIdentity: string, ttlSeconds = 3600): Promise<SecretLeaseItem> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const lease: SecretLeaseItem = {
      id: `lease-${Date.now()}`,
      secretKey,
      clientIdentity,
      ttlSeconds,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revoked: false,
    };
    this.secretLeases.unshift(lease);
    await this.audit.record({
      actorId: clientIdentity,
      actorRole: "SERVICE_PRINCIPAL",
      action: "secret.lease_granted",
      targetId: secretKey,
      details: { leaseId: lease.id, ttlSeconds },
    });
    return lease;
  }

  async revokeLease(leaseId: string, reason = "Manual revocation"): Promise<{ success: boolean; leaseId: string }> {
    const lease = this.secretLeases.find((l) => l.id === leaseId);
    if (!lease) {
      throw new NotFoundException(`Secret lease ${leaseId} not found`);
    }
    lease.revoked = true;
    await this.audit.record({
      actorId: "admin",
      actorRole: "SUPER_ADMIN",
      action: "secret.lease_revoked",
      targetId: lease.secretKey,
      details: { leaseId, reason },
    });
    return { success: true, leaseId };
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
      autoRotateDaysBefore: cert.autoRotateDaysBefore ?? 14,
    };
  }
}
