import { Vrpc } from "winccoa-manager";
import { MarketplaceService } from "./lib/Service";

const container = new Vrpc.ServiceContainer();
const marketplaceService = new MarketplaceService();

async function main() {
  try {
    console.log("Starting Marketplace Service...");

    container.registerService(marketplaceService);
    container.startAllServices();

    console.log("Marketplace Service created and registered successfully");
  } catch (error) {
    console.error("Failed to start Marketplace Service:", error);
  }
}

// Start the service
main();
