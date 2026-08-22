import { describe, expect, it, vi } from "vitest";

vi.mock("@kannan19302/database", () => ({ prisma: { gitConfig: { findUnique: vi.fn() } } }));
vi.mock("@/common/idp-client", () => ({ idpClient: {} }));

import { prisma } from "@kannan19302/database";
import { BuilderDevOpsService } from "../builder-devops.service";

describe("BuilderDevOpsService Git configuration", () => {
  it("never returns a stored access token from the read surface", async () => {
    (prisma.gitConfig.findUnique as any).mockResolvedValue({ id: "git-1", tenantId: "tenant-1", repoUrl: "https://example.test/repo.git", branch: "main", accessToken: "secret-token", status: "CONNECTED", lastSync: null });
    const result = await new BuilderDevOpsService().getGitConfig("tenant-1");
    expect(result).toMatchObject({ repoUrl: "https://example.test/repo.git", hasAccessToken: true });
    expect(result).not.toHaveProperty("accessToken");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
