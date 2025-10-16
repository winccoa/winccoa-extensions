import { Vrpc, WinccoaManager } from "winccoa-manager";
import { MarketplaceService } from "./lib/Service";

const container = new Vrpc.ServiceContainer();
const marketplaceService = new MarketplaceService();
const winccoa = new WinccoaManager();

async function main() {
  try {
    winccoa.logInfo("Starting Marketplace Service...");

    container.registerService(marketplaceService);
    container.startAllServices();

    winccoa.logInfo("Marketplace Service created and registered successfully");
  } catch (error) {
    winccoa.logSevere("Failed to start Marketplace Service:", error);
  }
}

// Start the service
main();
