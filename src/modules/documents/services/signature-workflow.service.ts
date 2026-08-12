import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { prisma } from "@kannan19302/database";
import { idpClient as idpPrisma } from "@/common/idp-client";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { createHash } from "crypto";

@Injectable()
export class SignatureWorkflowService {
  constructor(private eventEmitter: EventEmitter2) {}

  /**
   * A deterministic SHA-256 digest of the current state of every
   * signature on a document, sorted by signature id so field/row
   * ordering never affects the hash. This is the mechanism behind the
   * tamper-evident completion certificate: computed once at completion
   * and stored, then recomputed on demand — any later change to a
   * signature row (signedAt, ipAddress, signatureData, status) changes
   * the digest and is detected.
   */
  private computeCompletionHash(
    documentId: string,
    signatures: Array<{
      id: string;
      signerEmail: string;
      status: string;
      signedAt: Date | null;
      ipAddress: string | null;
      signatureData: string | null;
    }>,
  ): string {
    const canonical = [...signatures]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => ({
        id: s.id,
        signerEmail: s.signerEmail,
        status: s.status,
        signedAt: s.signedAt ? s.signedAt.toISOString() : null,
        ipAddress: s.ipAddress,
        signatureData: s.signatureData,
      }));
    const payload = JSON.stringify({ documentId, signatures: canonical });
    return createHash("sha256").update(payload).digest("hex");
  }

  async createSignatureRequest(
    tenantId: string,
    dto: {
      documentId: string;
      signerEmails: string[];
      sequential: boolean;
    },
  ) {
    const document = await prisma.document.findFirst({
      where: { id: dto.documentId, tenantId },
    });
    if (!document) throw new NotFoundException("Document not found");

    const signatures: any[] = [];
    for (const email of dto.signerEmails) {
      const sig = await prisma.signature.create({
        data: {
          tenantId,
          documentId: dto.documentId,
          signerEmail: email,
          status: "PENDING",
        },
      });
      signatures.push(sig);
    }

    // Notify signers
    const toNotify = dto.sequential
      ? dto.signerEmails.slice(0, 1)
      : dto.signerEmails;
    for (const email of toNotify) {
      this.eventEmitter.emit("notification.send", {
        tenantId,
        userId: "system",
        type: "SIGNATURE_REQUEST",
        title: `Signature requested on document ${document.name}`,
        body: `Please sign: ${email}`,
      });
    }

    return {
      documentId: dto.documentId,
      signatures,
      sequential: dto.sequential,
    };
  }

  async signDocument(
    tenantId: string,
    signatureId: string,
    signatureData: string,
    ipAddress?: string,
  ) {
    const signature = await prisma.signature.findFirst({
      where: { id: signatureId, tenantId },
    });
    if (!signature) throw new NotFoundException("Signature not found");
    if (signature.status !== "PENDING")
      throw new BadRequestException("Already signed or declined");

    await prisma.signature.update({
      where: { id: signatureId },
      data: {
        status: "SIGNED",
        signatureData,
        signedAt: new Date(),
        ipAddress: ipAddress || null,
      },
    });

    // Check if all signatures for this document are complete
    const remaining = await prisma.signature.count({
      where: { tenantId, documentId: signature.documentId, status: "PENDING" },
    });

    if (remaining === 0) {
      await prisma.document.update({
        where: { id: signature.documentId },
        data: { signatureStatus: "COMPLETED" },
      });

      // E31 exit criterion: "A signed document's integrity is verifiable
      // after the fact, and the trail is admissible." Completion alone
      // (a status flag) proves nothing was tampered with afterward —
      // the tamper-evident certificate is this hash, computed once here
      // over every signature's state and stored so it can be recomputed
      // and compared on demand.
      const allSignatures = await prisma.signature.findMany({
        where: { tenantId, documentId: signature.documentId },
      });
      const certificateHash = this.computeCompletionHash(
        signature.documentId,
        allSignatures,
      );
      await prisma.documentAuditLog.create({
        data: {
          tenantId,
          documentId: signature.documentId,
          action: "SIGNATURE_COMPLETION_CERTIFICATE",
          actorId: "system",
          details: {
            algorithm: "sha256",
            hash: certificateHash,
            signatureIds: allSignatures.map((s) => s.id).sort(),
          },
        },
      });

      this.eventEmitter.emit("notification.send", {
        tenantId,
        userId: "system",
        type: "SIGNATURE_COMPLETED",
        title: "All signatures collected",
      });
    }

    return { signatureId, status: "SIGNED", remainingSignatures: remaining };
  }

  /**
   * Recomputes the current signature-state hash and compares it to the
   * certificate stored at completion time — the actual "verifiable
   * after the fact" mechanism. If any signature row has been altered
   * since completion, verified is false and the mismatch is explicit,
   * not silently assumed.
   */
  async verifyDocumentIntegrity(tenantId: string, documentId: string) {
    const certificate = await prisma.documentAuditLog.findFirst({
      where: {
        tenantId,
        documentId,
        action: "SIGNATURE_COMPLETION_CERTIFICATE",
      },
      orderBy: { createdAt: "desc" },
    });
    if (!certificate) {
      throw new NotFoundException(
        "No completion certificate exists for this document — it has not completed signing.",
      );
    }
    const currentSignatures = await prisma.signature.findMany({
      where: { tenantId, documentId },
    });
    const currentHash = this.computeCompletionHash(
      documentId,
      currentSignatures,
    );
    const certifiedHash = (certificate.details as any)?.hash;
    return {
      documentId,
      verified: currentHash === certifiedHash,
      certifiedHash,
      currentHash,
      certifiedAt: certificate.createdAt,
    };
  }

  async getDocumentSignatures(tenantId: string, documentId: string) {
    const signatures = await prisma.signature.findMany({
      where: { tenantId, documentId },
      orderBy: { id: "asc" },
    });

    return {
      documentId,
      total: signatures.length,
      signed: signatures.filter((s) => s.status === "SIGNED").length,
      pending: signatures.filter((s) => s.status === "PENDING").length,
      signatures: signatures.map((s) => ({
        id: s.id,
        signerEmail: s.signerEmail,
        status: s.status,
        signedAt: s.signedAt,
      })),
    };
  }
}
