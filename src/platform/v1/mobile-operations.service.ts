import { Injectable } from "@nestjs/common";

export interface MobileBuild {
  id: string;
  platform: "ios" | "android";
  version: string;
  buildNumber: number;
  commitHash: string;
  branch: string;
  status: "BUILDING" | "READY" | "PUBLISHED" | "FAILED";
  artifactSizeMb: number;
  storeUrl?: string;
  createdAt: string;
}

export interface MobileReleaseChannel {
  channel: "alpha" | "beta" | "production";
  activeVersion: string;
  activeBuildNumber: number;
  rolloutPercentage: number;
  minOsVersion: { ios: string; android: string };
  updatedAt: string;
}

export interface MobileVersionPolicy {
  minSupportedVersion: string;
  latestVersion: string;
  forceUpdateEnabled: boolean;
  killswitchActive: boolean;
  gracePeriodDays: number;
  blockedVersions: string[];
}

export interface PushProviderBinding {
  provider: "FCM" | "APNs";
  environment: "production" | "sandbox";
  status: "HEALTHY" | "DEGRADED" | "EXPIRED";
  certificateExpiry: string;
  lastDeliveryCheck: string;
  successRate24h: number;
}

@Injectable()
export class MobileOperationsService {
  private builds: MobileBuild[] = [
    {
      id: "mob-bld-104",
      platform: "ios",
      version: "2.4.0",
      buildNumber: 104,
      commitHash: "e4f8b1c",
      branch: "release/2.4.0",
      status: "PUBLISHED",
      artifactSizeMb: 42.6,
      storeUrl: "https://apps.apple.com/app/unierp/id123456789",
      createdAt: new Date(Date.now() - 3600_000 * 24).toISOString(),
    },
    {
      id: "mob-bld-103",
      platform: "android",
      version: "2.4.0",
      buildNumber: 103,
      commitHash: "e4f8b1c",
      branch: "release/2.4.0",
      status: "PUBLISHED",
      artifactSizeMb: 38.1,
      storeUrl: "https://play.google.com/store/apps/details?id=com.unierp.mobile",
      createdAt: new Date(Date.now() - 3600_000 * 25).toISOString(),
    },
    {
      id: "mob-bld-105",
      platform: "ios",
      version: "2.5.0-beta.1",
      buildNumber: 105,
      commitHash: "a1c9d2f",
      branch: "main",
      status: "READY",
      artifactSizeMb: 43.2,
      createdAt: new Date(Date.now() - 3600_000 * 4).toISOString(),
    },
    {
      id: "mob-bld-106",
      platform: "android",
      version: "2.5.0-beta.1",
      buildNumber: 106,
      commitHash: "a1c9d2f",
      branch: "main",
      status: "READY",
      artifactSizeMb: 38.9,
      createdAt: new Date(Date.now() - 3600_000 * 3).toISOString(),
    },
  ];

  private channels: MobileReleaseChannel[] = [
    {
      channel: "production",
      activeVersion: "2.4.0",
      activeBuildNumber: 104,
      rolloutPercentage: 100,
      minOsVersion: { ios: "16.0", android: "10.0" },
      updatedAt: new Date(Date.now() - 3600_000 * 24).toISOString(),
    },
    {
      channel: "beta",
      activeVersion: "2.5.0-beta.1",
      activeBuildNumber: 106,
      rolloutPercentage: 25,
      minOsVersion: { ios: "16.4", android: "11.0" },
      updatedAt: new Date(Date.now() - 3600_000 * 3).toISOString(),
    },
    {
      channel: "alpha",
      activeVersion: "2.5.0-alpha.3",
      activeBuildNumber: 102,
      rolloutPercentage: 100,
      minOsVersion: { ios: "17.0", android: "12.0" },
      updatedAt: new Date(Date.now() - 3600_000 * 48).toISOString(),
    },
  ];

  private versionPolicy: MobileVersionPolicy = {
    minSupportedVersion: "2.2.0",
    latestVersion: "2.4.0",
    forceUpdateEnabled: false,
    killswitchActive: false,
    gracePeriodDays: 7,
    blockedVersions: ["2.0.1", "2.1.0"],
  };

  private pushProviders: PushProviderBinding[] = [
    {
      provider: "APNs",
      environment: "production",
      status: "HEALTHY",
      certificateExpiry: new Date(Date.now() + 3600_000 * 24 * 180).toISOString(),
      lastDeliveryCheck: new Date(Date.now() - 60_000 * 5).toISOString(),
      successRate24h: 99.85,
    },
    {
      provider: "FCM",
      environment: "production",
      status: "HEALTHY",
      certificateExpiry: new Date(Date.now() + 3600_000 * 24 * 320).toISOString(),
      lastDeliveryCheck: new Date(Date.now() - 60_000 * 2).toISOString(),
      successRate24h: 99.92,
    },
  ];

  async getDashboard() {
    return {
      overview: {
        totalBuilds: this.builds.length,
        activeChannels: this.channels.length,
        killswitchActive: this.versionPolicy.killswitchActive,
        forceUpdateEnabled: this.versionPolicy.forceUpdateEnabled,
        minVersion: this.versionPolicy.minSupportedVersion,
        latestVersion: this.versionPolicy.latestVersion,
      },
      channels: this.channels,
      pushProviders: this.pushProviders,
      recentBuilds: this.builds.slice(0, 10),
    };
  }

  async listBuilds() {
    return this.builds;
  }

  async registerBuild(input: {
    platform: "ios" | "android";
    version: string;
    buildNumber: number;
    commitHash: string;
    branch?: string;
    artifactSizeMb?: number;
    storeUrl?: string;
  }) {
    const build: MobileBuild = {
      id: `mob-bld-${input.buildNumber || Date.now()}`,
      platform: input.platform,
      version: input.version,
      buildNumber: input.buildNumber,
      commitHash: input.commitHash,
      branch: input.branch || "main",
      status: "READY",
      artifactSizeMb: input.artifactSizeMb || 40.0,
      storeUrl: input.storeUrl,
      createdAt: new Date().toISOString(),
    };
    this.builds.unshift(build);
    return build;
  }

  async listChannels() {
    return this.channels;
  }

  async promoteChannel(input: {
    channel: "alpha" | "beta" | "production";
    version: string;
    buildNumber: number;
    rolloutPercentage?: number;
  }) {
    const ch = this.channels.find((c) => c.channel === input.channel);
    if (!ch) throw new Error(`Channel ${input.channel} not found`);
    ch.activeVersion = input.version;
    ch.activeBuildNumber = input.buildNumber;
    if (typeof input.rolloutPercentage === "number") {
      ch.rolloutPercentage = Math.max(0, Math.min(100, input.rolloutPercentage));
    }
    ch.updatedAt = new Date().toISOString();
    return ch;
  }

  async getVersionPolicy() {
    return this.versionPolicy;
  }

  async updateVersionPolicy(input: Partial<MobileVersionPolicy>) {
    this.versionPolicy = { ...this.versionPolicy, ...input };
    return this.versionPolicy;
  }

  async listPushProviders() {
    return this.pushProviders;
  }

  async testPushNotification(input: { provider: "FCM" | "APNs"; deviceToken?: string }) {
    return {
      success: true,
      provider: input.provider,
      messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      delivered: true,
    };
  }
}
