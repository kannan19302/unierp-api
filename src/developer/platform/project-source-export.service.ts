import { Injectable } from "@nestjs/common";
import { ProjectReleasesService, releaseDigest } from "./project-releases.service";

/** Portable, source-first view for CLI, Git and IDE integrations. It is a
 * projection of canonical IR—not a generated code fork—so edits return via
 * optimistic artifact revisions and remain visible to visual builders. */
@Injectable()
export class ProjectSourceExportService {
  constructor(private readonly releases: ProjectReleasesService) {}
  async export(tenantId: string, projectId: string) {
    const composition = await this.releases.currentComposition(tenantId, projectId);
    const bundle = {
      apiVersion: "unierp.project-source/v1",
      projectId,
      sourceFingerprint: composition.fingerprint,
      packages: composition.packages,
      artifacts: composition.artifacts.map((artifact) => ({
        id: artifact.artifactId, kind: artifact.artifactType, revision: artifact.revision,
        contentHash: artifact.sourceHash, source: artifact.source,
      })),
      requiredBindings: composition.requiredBindings,
    };
    return { ...bundle, bundleHash: releaseDigest(bundle) };
  }
}
