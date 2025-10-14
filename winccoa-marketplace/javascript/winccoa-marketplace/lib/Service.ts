import { Vrpc } from "winccoa-manager";
import { AddOnHandler } from "./AddOnHandler";

export class MarketplaceService extends Vrpc.ServiceBase {
  private _addOnHandler: AddOnHandler;

  constructor() {
    super("Marketplace");

    this.registerFunction("register", this.registerSubProjects.bind(this));
    this.registerFunction("unregister", this.unregisterSubProjects.bind(this));
    this.registerFunction(
      "listProjects",
      this.listRegisteredSubProjects.bind(this),
    );

    this.registerFunction("pull", this.pullRepository.bind(this));
    this.registerFunction("clone", this.cloneRepository.bind(this));
    this.registerFunction("listRepos", this.listRemoteRepositories.bind(this));

    this._addOnHandler = new AddOnHandler();
  }

  private async registerSubProjects(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const paths = request.getStringArray();

   for (const path of paths) {
      console.log("Registering sub-project at path:", path);
      const result = await this._addOnHandler.registerSubProject(path);
      console.log(`Sub-project ${path} registered with result code:`, result);
    }

    return Vrpc.Variant.createBool(true);
  }

  private async unregisterSubProjects(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const paths = request.getStringArray();
    for (const path of paths) {
      console.log("Unregistering sub-project at path:", path);
      const result = await this._addOnHandler.unregisterSubProject(path);
      console.log(`Sub-project ${path} unregistered with result code:`, result);
    });
    return Vrpc.Variant.createBool(true);
  }

  private async listRegisteredSubProjects(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    console.log("Listing registered sub-projects");
    const result = await this._addOnHandler.listSubProjects();
    console.log("Registered sub-projects listed with result code:", result);
    return Vrpc.Variant.createStringArray(result);
  }

  private async listRemoteRepositories(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const organizationName = request.getString();
    console.log("Fetching repositories for organization:", organizationName);

    const orgRepos = await this._addOnHandler.listOrganizationRepositories(
      organizationName,
      {
        type: "public",
        sort: "updated",
        direction: "desc",
      },
    );

    console.log("Fetched repositories:", orgRepos);

    return Vrpc.Variant.createString(JSON.stringify(orgRepos));
  }

  private async pullRepository(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const directory = request.getString();
    console.log("Pulling latest changes in directory:", directory);

    await this._addOnHandler.pullRepository(directory);

    return Vrpc.Variant.createUndefined();
  }

  private async cloneRepository(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    let repositoryURL: string;
    let targetDir: string | undefined;
    let branch: string | undefined;

    // Get the mapping object - using cast since TypeScript doesn't know about asMapping
    const mapping = request.getMapping();
    // Extract URL from mapping
    const urlVariant = mapping.get(Vrpc.Variant.createString("url"));
    if (!urlVariant) {
      throw new Error('Missing required "url" parameter in mapping');
    }
    repositoryURL = urlVariant.getString();

    // Extract optional parameters from mapping
    const branchVariant = mapping.get(Vrpc.Variant.createString("branch"));
    const targetDirVariant = mapping.get(
      Vrpc.Variant.createString("targetDirectory"),
    );

    targetDir = targetDirVariant ? targetDirVariant.getString() : undefined;
    branch = branchVariant ? branchVariant.getString() : undefined;

    console.log("Cloning repository:", repositoryURL);
    if (targetDir) console.log("Target directory:", targetDir);
    if (branch) console.log("Branch:", branch);

    await this._addOnHandler.cloneRepositoryFromUrl(
      repositoryURL,
      targetDir,
      branch,
    );

    return Vrpc.Variant.createUndefined();
  }
}
