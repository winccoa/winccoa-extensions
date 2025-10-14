import { Vrpc } from "winccoa-manager";
import { VrpcStub } from "winccoa-manager/lib/msa/Vrpc/Client/VrpcStub";
import { VrpcStubOptions } from "winccoa-manager/lib/msa/Vrpc/Client/VrpcStubOptions";

async function testMarketplaceService() {
  try {
    console.log("=== Testing Marketplace Service ===\n");
    
    const clientContext = new Vrpc.ClientContext();
    const stub = await VrpcStub.createAndInitialize("marketplace", new VrpcStubOptions());
    const result = await stub.callFunction("listRepos", clientContext, Vrpc.Variant.createUndefined());
    
    console.log("Test call result value JSON:", JSON.stringify(result.response.value, null, 2));

    console.log("\nTest completed successfully!");
  
  } catch (error) {
    console.error("Test failed:", error);
  }

  process.exit(1);
}

// Run the test
testMarketplaceService().catch((error) => {
  console.error("Unhandled error in test:", error);
  process.exit(1);
});