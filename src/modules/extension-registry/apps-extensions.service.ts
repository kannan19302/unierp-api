import { Injectable } from "@nestjs/common";

export interface InstalledExtension {
  id: string;
  extensionKey: string;
  name: string;
  description: string;
  publisher: string;
  installedVersion: string;
  latestVersion: string;
  category: string;
  permissionsGranted: string[];
  installedAt: string;
  updateChannel: "stable" | "beta";
  autoUpdate: boolean;
  status: "ACTIVE" | "PAUSED" | "UPDATE_AVAILABLE";
  healthStatus: "OK" | "WARNING" | "ERROR";
  configValues: Record<string, unknown>;
}

export interface MarketplaceAppListing {
  key: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  category: string;
  rating: number;
  installCount: number;
  requiredPermissions: string[];
  icon: string;
  price: string;
}

@Injectable()
export class AppsExtensionsService {
  private installed: Record<string, InstalledExtension[]> = {};

  private availableCatalog: MarketplaceAppListing[] = [
    {
      key: "ext-stripe-recon",
      name: "Stripe Automated Reconciliation",
      description: "Match payout batches and gateway fees directly into General Ledger entries.",
      publisher: "UniERP Financial Suite",
      version: "2.1.0",
      category: "Finance",
      rating: 4.9,
      installCount: 1420,
      requiredPermissions: ["finance.read", "finance.write", "banking.reconcile"],
      icon: "CreditCard",
      price: "Included in Enterprise",
    },
    {
      key: "ext-slack-alerts",
      name: "Slack & Microsoft Teams Notifications",
      description: "Dispatch urgent workflow approval requests and system incident pings to team channels.",
      publisher: "UniERP Connect",
      version: "1.4.2",
      category: "Communication",
      rating: 4.8,
      installCount: 3890,
      requiredPermissions: ["notifications.send", "workflow.read"],
      icon: "MessageSquare",
      price: "Free",
    },
    {
      key: "ext-salesforce-sync",
      name: "Salesforce CRM Two-Way Sync",
      description: "Bi-directional customer, contract, and invoice synchronization with automated conflict resolution.",
      publisher: "Enterprise Bridges Ltd",
      version: "3.0.1",
      category: "CRM & Sales",
      rating: 4.7,
      installCount: 890,
      requiredPermissions: ["crm.read", "crm.write", "sales.read", "sales.write"],
      icon: "RefreshCw",
      price: "$49/mo",
    },
    {
      key: "ext-docusign-bridge",
      name: "DocuSign e-Signature Orchestrator",
      description: "Embed e-signatures into procurement POs, customer quotes, and employment contracts.",
      publisher: "Signatures Hub",
      version: "1.8.0",
      category: "Documents",
      rating: 4.9,
      installCount: 2150,
      requiredPermissions: ["documents.read", "documents.sign", "procurement.read"],
      icon: "FileCheck",
      price: "$29/mo",
    },
    {
      key: "ext-fedex-shipping",
      name: "FedEx & DHL Global Logistics",
      description: "Real-time rate calculation, automatic label generation, and warehouse tracking updates.",
      publisher: "Logistics Pro",
      version: "2.0.4",
      category: "Supply Chain",
      rating: 4.6,
      installCount: 1100,
      requiredPermissions: ["inventory.read", "shipping.generate", "orders.read"],
      icon: "Truck",
      price: "$19/mo",
    },
  ];

  private initTenant(tenantId: string) {
    if (!this.installed[tenantId]) {
      this.installed[tenantId] = [
        {
          id: "inst-01",
          extensionKey: "ext-stripe-recon",
          name: "Stripe Automated Reconciliation",
          description: "Match payout batches and gateway fees directly into General Ledger entries.",
          publisher: "UniERP Financial Suite",
          installedVersion: "2.1.0",
          latestVersion: "2.1.0",
          category: "Finance",
          permissionsGranted: ["finance.read", "finance.write", "banking.reconcile"],
          installedAt: new Date(Date.now() - 3600_000 * 24 * 60).toISOString(),
          updateChannel: "stable",
          autoUpdate: true,
          status: "ACTIVE",
          healthStatus: "OK",
          configValues: { webhookSync: true, autoPostBatch: true, maxBatchLimit: 5000 },
        },
        {
          id: "inst-02",
          extensionKey: "ext-slack-alerts",
          name: "Slack & Microsoft Teams Notifications",
          description: "Dispatch urgent workflow approval requests and system incident pings to team channels.",
          publisher: "UniERP Connect",
          installedVersion: "1.4.0",
          latestVersion: "1.4.2",
          category: "Communication",
          permissionsGranted: ["notifications.send", "workflow.read"],
          installedAt: new Date(Date.now() - 3600_000 * 24 * 30).toISOString(),
          updateChannel: "stable",
          autoUpdate: false,
          status: "UPDATE_AVAILABLE",
          healthStatus: "OK",
          configValues: { webhookUrl: "https://hooks.slack.com/services/T00/B00/X00", notifySeverity: "HIGH" },
        },
        {
          id: "inst-03",
          extensionKey: "ext-docusign-bridge",
          name: "DocuSign e-Signature Orchestrator",
          description: "Embed e-signatures into procurement POs, customer quotes, and employment contracts.",
          publisher: "Signatures Hub",
          installedVersion: "1.8.0",
          latestVersion: "1.8.0",
          category: "Documents",
          permissionsGranted: ["documents.read", "documents.sign", "procurement.read"],
          installedAt: new Date(Date.now() - 3600_000 * 24 * 10).toISOString(),
          updateChannel: "stable",
          autoUpdate: true,
          status: "ACTIVE",
          healthStatus: "OK",
          configValues: { accountId: "docu-acct-88910", environment: "production" },
        },
      ];
    }
  }

  async getDashboard(tenantId: string) {
    this.initTenant(tenantId);
    const installed = this.installed[tenantId];
    return {
      totalInstalled: installed.length,
      activeCount: installed.filter((e) => e.status === "ACTIVE").length,
      updatesAvailable: installed.filter((e) => e.status === "UPDATE_AVAILABLE").length,
      healthIssues: installed.filter((e) => e.healthStatus !== "OK").length,
      installedExtensions: installed,
      recommendedCatalog: this.availableCatalog.filter(
        (cat) => !installed.some((inst) => inst.extensionKey === cat.key),
      ),
    };
  }

  async listInstalled(tenantId: string) {
    this.initTenant(tenantId);
    return this.installed[tenantId];
  }

  async listCatalog(tenantId: string) {
    return this.availableCatalog;
  }

  async installExtension(
    tenantId: string,
    input: {
      extensionKey: string;
      updateChannel?: "stable" | "beta";
      autoUpdate?: boolean;
      configValues?: Record<string, unknown>;
    },
  ) {
    this.initTenant(tenantId);
    const catalogItem = this.availableCatalog.find((c) => c.key === input.extensionKey);
    if (!catalogItem) throw new Error("Extension not found in marketplace catalog");

    const existing = this.installed[tenantId].find((i) => i.extensionKey === input.extensionKey);
    if (existing) {
      existing.status = "ACTIVE";
      return existing;
    }

    const newInstall: InstalledExtension = {
      id: `inst-${Date.now()}`,
      extensionKey: catalogItem.key,
      name: catalogItem.name,
      description: catalogItem.description,
      publisher: catalogItem.publisher,
      installedVersion: catalogItem.version,
      latestVersion: catalogItem.version,
      category: catalogItem.category,
      permissionsGranted: catalogItem.requiredPermissions,
      installedAt: new Date().toISOString(),
      updateChannel: input.updateChannel || "stable",
      autoUpdate: input.autoUpdate ?? true,
      status: "ACTIVE",
      healthStatus: "OK",
      configValues: input.configValues || {},
    };

    this.installed[tenantId].unshift(newInstall);
    return newInstall;
  }

  async toggleExtension(tenantId: string, id: string, enabled: boolean) {
    this.initTenant(tenantId);
    const ext = this.installed[tenantId].find((e) => e.id === id);
    if (!ext) throw new Error("Installed extension not found");
    ext.status = enabled ? "ACTIVE" : "PAUSED";
    return ext;
  }

  async updateExtension(tenantId: string, id: string) {
    this.initTenant(tenantId);
    const ext = this.installed[tenantId].find((e) => e.id === id);
    if (!ext) throw new Error("Installed extension not found");
    ext.installedVersion = ext.latestVersion;
    ext.status = "ACTIVE";
    return ext;
  }

  async configureExtension(
    tenantId: string,
    id: string,
    config: Record<string, unknown>,
  ) {
    this.initTenant(tenantId);
    const ext = this.installed[tenantId].find((e) => e.id === id);
    if (!ext) throw new Error("Installed extension not found");
    ext.configValues = { ...ext.configValues, ...config };
    return ext;
  }

  async uninstallExtension(tenantId: string, id: string) {
    this.initTenant(tenantId);
    const index = this.installed[tenantId].findIndex((e) => e.id === id);
    if (index === -1) throw new Error("Installed extension not found");
    const [removed] = this.installed[tenantId].splice(index, 1);
    return removed;
  }
}
