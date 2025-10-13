import { Vrpc } from "winccoa-manager";
import { MarketplaceService } from "./lib/Service";

async function main() {
  try {
    console.log("=== WinCC OA Marketplace Service ===\n");
    console.log("Starting Marketplace Service...");
    
    // Create the MarketplaceService instance
    const marketplaceService = new MarketplaceService();
    const container = new Vrpc.ServiceContainer();

    container.registerService(marketplaceService);
    container.startAllServices();
    
    // The ServiceBase class automatically handles Vrpc registration
    // when instantiated, so we just need to create the service
    console.log("Marketplace Service created and registered successfully");
    
    // Handle graceful shutdown
    const shutdown = async () => {
      console.log("\n Shutting down Marketplace Service...");
      // The ServiceBase will handle cleanup automatically
      console.log("Service stopped successfully");
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep the process running
    process.stdin.resume();
    
  } catch (error) {
    console.error("Failed to start Marketplace Service:", error);
    process.exit(1);
  }
}

// Start the service
main().catch((error) => {
  console.error("Unhandled error in main:", error);
  process.exit(1);
});
