import { Vrpc, WinccoaManager } from "winccoa-manager";
import { ExtensionsService } from "./lib/Service";

const container = new Vrpc.ServiceContainer();
const extensionsService = new ExtensionsService();
const winccoa = new WinccoaManager();

async function main() {
  try {
    winccoa.logInfo("Starting Extensions Service...");

    container.registerService(extensionsService);
    await container.startAllServices();

    winccoa.logInfo("Extensions Service created and registered successfully");

    // Run startup tasks (e.g., DbUpdateScripts for all registered extensions)
    await extensionsService.runStartupTasks();
  } catch (error) {
    winccoa.logSevere("Failed to start Extensions Service:", error);
  }
}

// Start the service
main();
