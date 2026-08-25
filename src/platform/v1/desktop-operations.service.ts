import { Injectable } from "@nestjs/common";

export interface DesktopBuild {
  id: string;
  targetOs: "windows-x64" | "windows-arm64" | "macos-arm64" | "macos-x64" | "linux-x64";
  version: string;
  installerType: "exe" | "msi" | "dmg" | "pkg" | "deb" | "AppImage";
  commitHash: string;
  sha256: string;
  signatureStatus: "SIGNED_VERIFIED" | "NOTARIZED" | "SELF_SIGNED" | "PENDING";
  fileSizeBytes: number;
  downloadUrl?: string;
  createdAt: string;
}

export interface DesktopReleaseChannel {
  channel: "stable" | "beta" | "nightly";
  activeVersion: string;
  rolloutPercentage: number;
  autoUpdateEnabled: boolean;
  minOsRequirements: { windows: string; macos: string; linux: string };
  updatedAt: string;
}

export interface DesktopUpdatePolicy {
  minSupportedVersion: string;
  latestVersion: string;
  autoDownload: boolean;
  mandatoryRestartMinutes: number;
  killswitchActive: boolean;
  blockedVersions: string[];
}

export interface CodeSigningProfile {
  platform: "Apple Notarization" | "Windows EV Authenticode" | "Linux GPG";
  identity: string;
  certificateExpiry: string;
  status: "VALID" | "EXPIRING_SOON" | "EXPIRED";
  timestampServer: string;
}

@Injectable()
export class DesktopOperationsService {
  private builds: DesktopBuild[] = [
    {
      id: "desk-bld-210",
      targetOs: "windows-x64",
      version: "1.8.0",
      installerType: "msi",
      commitHash: "c98f12a",
      sha256: "8f9d12a4b88931f76d491f28b3379201947a192837482910fa8921bcadef4812",
      signatureStatus: "SIGNED_VERIFIED",
      fileSizeBytes: 84_500_000,
      downloadUrl: "https://releases.unierp.com/desktop/v1.8.0/UniERP-Setup-1.8.0-x64.msi",
      createdAt: new Date(Date.now() - 3600_000 * 24 * 3).toISOString(),
    },
    {
      id: "desk-bld-211",
      targetOs: "macos-arm64",
      version: "1.8.0",
      installerType: "dmg",
      commitHash: "c98f12a",
      sha256: "5e2b819f8a7c29304857129f8a7e3d1c4b829102948571829384756102938475",
      signatureStatus: "NOTARIZED",
      fileSizeBytes: 78_200_000,
      downloadUrl: "https://releases.unierp.com/desktop/v1.8.0/UniERP-1.8.0-arm64.dmg",
      createdAt: new Date(Date.now() - 3600_000 * 24 * 3).toISOString(),
    },
    {
      id: "desk-bld-212",
      targetOs: "linux-x64",
      version: "1.8.0",
      installerType: "AppImage",
      commitHash: "c98f12a",
      sha256: "3d1c4b8291029485718293847561029384755e2b819f8a7c29304857129f8a7e",
      signatureStatus: "SIGNED_VERIFIED",
      fileSizeBytes: 91_400_000,
      downloadUrl: "https://releases.unierp.com/desktop/v1.8.0/UniERP-1.8.0-x86_64.AppImage",
      createdAt: new Date(Date.now() - 3600_000 * 24 * 3).toISOString(),
    },
    {
      id: "desk-bld-213",
      targetOs: "windows-x64",
      version: "1.9.0-beta.1",
      installerType: "msi",
      commitHash: "f1a2b3c",
      sha256: "47561029384755e2b819f8a7c29304857129f8a7e3d1c4b82910294857182938",
      signatureStatus: "SIGNED_VERIFIED",
      fileSizeBytes: 86_100_000,
      createdAt: new Date(Date.now() - 3600_000 * 5).toISOString(),
    },
  ];

  private channels: DesktopReleaseChannel[] = [
    {
      channel: "stable",
      activeVersion: "1.8.0",
      rolloutPercentage: 100,
      autoUpdateEnabled: true,
      minOsRequirements: { windows: "10.0.19041", macos: "12.0", linux: "glibc-2.31" },
      updatedAt: new Date(Date.now() - 3600_000 * 24 * 3).toISOString(),
    },
    {
      channel: "beta",
      activeVersion: "1.9.0-beta.1",
      rolloutPercentage: 50,
      autoUpdateEnabled: true,
      minOsRequirements: { windows: "10.0.19045", macos: "13.0", linux: "glibc-2.34" },
      updatedAt: new Date(Date.now() - 3600_000 * 5).toISOString(),
    },
    {
      channel: "nightly",
      activeVersion: "2.0.0-nightly.20260824",
      rolloutPercentage: 100,
      autoUpdateEnabled: false,
      minOsRequirements: { windows: "11.0", macos: "14.0", linux: "glibc-2.35" },
      updatedAt: new Date(Date.now() - 3600_000 * 12).toISOString(),
    },
  ];

  private updatePolicy: DesktopUpdatePolicy = {
    minSupportedVersion: "1.6.0",
    latestVersion: "1.8.0",
    autoDownload: true,
    mandatoryRestartMinutes: 120,
    killswitchActive: false,
    blockedVersions: ["1.5.2", "1.7.1"],
  };

  private signingProfiles: CodeSigningProfile[] = [
    {
      platform: "Apple Notarization",
      identity: "Developer ID Application: UniERP Global Inc. (4X789AB2CD)",
      certificateExpiry: new Date(Date.now() + 3600_000 * 24 * 240).toISOString(),
      status: "VALID",
      timestampServer: "http://timestamp.apple.com/ts01",
    },
    {
      platform: "Windows EV Authenticode",
      identity: "UniERP Software Corp. - Sectigo EV Code Signing",
      certificateExpiry: new Date(Date.now() + 3600_000 * 24 * 310).toISOString(),
      status: "VALID",
      timestampServer: "http://timestamp.sectigo.com",
    },
    {
      platform: "Linux GPG",
      identity: "UniERP Packaging <packages@unierp.com>",
      certificateExpiry: new Date(Date.now() + 3600_000 * 24 * 700).toISOString(),
      status: "VALID",
      timestampServer: "pgp.mit.edu",
    },
  ];

  async getDashboard() {
    return {
      overview: {
        totalBuilds: this.builds.length,
        activeChannels: this.channels.length,
        killswitchActive: this.updatePolicy.killswitchActive,
        autoDownload: this.updatePolicy.autoDownload,
        minVersion: this.updatePolicy.minSupportedVersion,
        latestVersion: this.updatePolicy.latestVersion,
      },
      channels: this.channels,
      signingProfiles: this.signingProfiles,
      recentBuilds: this.builds.slice(0, 10),
    };
  }

  async listBuilds() {
    return this.builds;
  }

  async registerBuild(input: {
    targetOs: "windows-x64" | "windows-arm64" | "macos-arm64" | "macos-x64" | "linux-x64";
    version: string;
    installerType: "exe" | "msi" | "dmg" | "pkg" | "deb" | "AppImage";
    commitHash: string;
    sha256: string;
    fileSizeBytes?: number;
    downloadUrl?: string;
  }) {
    const build: DesktopBuild = {
      id: `desk-bld-${Date.now()}`,
      targetOs: input.targetOs,
      version: input.version,
      installerType: input.installerType,
      commitHash: input.commitHash,
      sha256: input.sha256,
      signatureStatus: "SIGNED_VERIFIED",
      fileSizeBytes: input.fileSizeBytes || 80_000_000,
      downloadUrl: input.downloadUrl,
      createdAt: new Date().toISOString(),
    };
    this.builds.unshift(build);
    return build;
  }

  async listChannels() {
    return this.channels;
  }

  async promoteChannel(input: {
    channel: "stable" | "beta" | "nightly";
    version: string;
    rolloutPercentage?: number;
  }) {
    const ch = this.channels.find((c) => c.channel === input.channel);
    if (!ch) throw new Error(`Channel ${input.channel} not found`);
    ch.activeVersion = input.version;
    if (typeof input.rolloutPercentage === "number") {
      ch.rolloutPercentage = Math.max(0, Math.min(100, input.rolloutPercentage));
    }
    ch.updatedAt = new Date().toISOString();
    return ch;
  }

  async getUpdatePolicy() {
    return this.updatePolicy;
  }

  async updateUpdatePolicy(input: Partial<DesktopUpdatePolicy>) {
    this.updatePolicy = { ...this.updatePolicy, ...input };
    return this.updatePolicy;
  }

  async getSigningProfiles() {
    return this.signingProfiles;
  }
}
