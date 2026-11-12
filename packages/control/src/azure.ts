import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { DefaultAzureCredential } from "@azure/identity";
import type { VmPowerState, VmStatus } from "@cloudpilot/shared";
import type { Config } from "./config.js";

/** Everything the control plane needs from Azure. Faked in tests. */
export interface VmController {
  status(): Promise<Omit<VmStatus, "agentHealthy">>;
  /** Ensure the public IP exists and is attached, then start. Does not wait for boot. */
  start(): Promise<void>;
  /** Deallocate (stops compute billing). Does not wait. */
  deallocate(): Promise<void>;
  /** Detach + delete the public IP (only valid while deallocated). Returns true if something was deleted. */
  releasePublicIp(): Promise<boolean>;
  /** Change size. VM must be deallocated. */
  resize(size: string): Promise<void>;
}

export function mapPowerState(codes: (string | undefined)[]): VmPowerState {
  const code = codes.find((c) => c?.startsWith("PowerState/"))?.slice("PowerState/".length);
  switch (code) {
    case "running":
    case "starting":
    case "stopping":
    case "deallocating":
    case "deallocated":
    case "stopped":
      return code;
    default:
      return "unknown";
  }
}

export class AzureVmController implements VmController {
  private readonly compute: ComputeManagementClient;
  private readonly network: NetworkManagementClient;

  constructor(private readonly cfg: Config) {
    const cred = new DefaultAzureCredential();
    this.compute = new ComputeManagementClient(cred, cfg.subscriptionId);
    this.network = new NetworkManagementClient(cred, cfg.subscriptionId);
  }

  async status() {
    const { resourceGroup: rg, vmName } = this.cfg;
    const [vm, iv] = await Promise.all([
      this.compute.virtualMachines.get(rg, vmName),
      this.compute.virtualMachines.instanceView(rg, vmName),
    ]);
    const statuses = iv.statuses ?? [];
    const power = mapPowerState(statuses.map((s) => s.code));
    const powerStatus = statuses.find((s) => s.code?.startsWith("PowerState/"));
    let publicIp: string | null = null;
    let fqdn: string | null = null;
    try {
      const pip = await this.network.publicIPAddresses.get(rg, this.cfg.pipName);
      publicIp = pip.ipAddress ?? null;
      fqdn = pip.dnsSettings?.fqdn ?? null;
    } catch {
      /* no IP while stopped */
    }
    return {
      power,
      size: vm.hardwareProfile?.vmSize ?? "unknown",
      region: vm.location,
      fqdn,
      publicIp,
      since: powerStatus?.time ? new Date(powerStatus.time).toISOString() : null,
    };
  }

  private async ensurePublicIp() {
    const { resourceGroup: rg, pipName, nicName, location, dnsLabel } = this.cfg;
    const pip = await this.network.publicIPAddresses.beginCreateOrUpdateAndWait(rg, pipName, {
      location,
      sku: { name: "Standard" },
      publicIPAllocationMethod: "Static",
      dnsSettings: { domainNameLabel: dnsLabel },
      tags: { app: "cloudpilot" },
    });
    const nic = await this.network.networkInterfaces.get(rg, nicName);
    const ipc = nic.ipConfigurations?.[0];
    if (ipc && ipc.publicIPAddress?.id?.toLowerCase() !== pip.id?.toLowerCase()) {
      ipc.publicIPAddress = { id: pip.id };
      await this.network.networkInterfaces.beginCreateOrUpdateAndWait(rg, nicName, nic);
    }
  }

  async start() {
    await this.ensurePublicIp();
    await this.compute.virtualMachines.beginStart(this.cfg.resourceGroup, this.cfg.vmName);
  }

  async deallocate() {
    await this.compute.virtualMachines.beginDeallocate(this.cfg.resourceGroup, this.cfg.vmName);
  }

  async releasePublicIp() {
    const { resourceGroup: rg, pipName, nicName } = this.cfg;
    try {
      await this.network.publicIPAddresses.get(rg, pipName);
    } catch {
      return false;
    }
    const nic = await this.network.networkInterfaces.get(rg, nicName);
    const ipc = nic.ipConfigurations?.[0];
    if (ipc?.publicIPAddress) {
      ipc.publicIPAddress = undefined;
      await this.network.networkInterfaces.beginCreateOrUpdateAndWait(rg, nicName, nic);
    }
    await this.network.publicIPAddresses.beginDeleteAndWait(rg, pipName);
    return true;
  }

  async resize(size: string) {
    await this.compute.virtualMachines.beginUpdateAndWait(this.cfg.resourceGroup, this.cfg.vmName, {
      hardwareProfile: { vmSize: size },
    });
  }
}
