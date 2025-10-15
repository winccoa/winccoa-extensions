import { Vrpc } from "winccoa-manager";
import { AddOnHandler, Manager } from "./AddOnHandler";

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
    try {
      console.log("check if request is mapping:", request.isMapping());
      const requestMapping = request.getMapping();

      // Convert mapping to JavaScript object for easier access
      const requestObject = requestMapping.convertToObject() as any;

      console.log("requestObject:", requestObject);

      // Extract repositoryPath using requestMapping for the keys
      const repositoryPathVariant = requestMapping.get(
        Vrpc.Variant.createString("repositoryPath"),
      );
      if (!repositoryPathVariant) {
        throw new Error(
          'Missing required "repositoryPath" parameter in mapping',
        );
      }
      const repositoryPath = repositoryPathVariant.getString();
      console.log("-------- repositoryPath:", repositoryPath);

      // Extract fileContent using requestMapping for the keys
      const fileContentVariant = requestMapping.get(
        Vrpc.Variant.createString("fileContent"),
      );
      if (!fileContentVariant) {
        throw new Error('Missing required "fileContent" parameter in mapping');
      }
      const fileContent = fileContentVariant.getString();
      console.log("-------- fileContent:", fileContent);

      const result =
        await this._addOnHandler.registerSubProject(repositoryPath);

      console.log(
        `Sub-project ${repositoryPath} registered with result code:`,
        result,
      );

      return Vrpc.Variant.createBool(true);
    } catch (error) {
      console.error("Error in registerSubProjects:", error);
      throw error;
    }
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
    }
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
    let organizationName: string;

    if (request.isString()) {
      organizationName = request.getString();
    } else {
      organizationName = "winccoa";
    }

    const orgRepos = await this._addOnHandler.listOrganizationRepositories(
      organizationName,
      {
        type: "public",
        sort: "updated",
        direction: "desc",
      },
    );

    return Vrpc.Variant.createString(JSON.stringify(orgRepos));
  }

  private async pullRepository(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const directory = request.getString();

    const result = await this._addOnHandler.pullRepository(directory);

    // return number of changes
    // TODO: return also what has changed (list of files)
    return Vrpc.Variant.createInt(result.changes);
  }

  private async cloneRepository(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    let repositoryURL: string;
    let targetDir: string | undefined;
    let branch: string | undefined;

    const requestMapping = request.getMapping();

    // Extract URL from mapping
    const urlVariant = requestMapping.get(Vrpc.Variant.createString("url"));
    if (!urlVariant) {
      throw new Error('Missing required "url" parameter in mapping');
    }
    repositoryURL = urlVariant.getString();

    // Extract optional parameters targetDirectory and branch from mapping
    const branchVariant = requestMapping.get(
      Vrpc.Variant.createString("branch"),
    );
    const targetDirVariant = requestMapping.get(
      Vrpc.Variant.createString("targetDirectory"),
    );

    targetDir = targetDirVariant ? targetDirVariant.getString() : undefined;
    branch = branchVariant ? branchVariant.getString() : undefined;

    const result = await this._addOnHandler.cloneRepository(
      repositoryURL,
      targetDir,
      branch,
    );

    const resultMapping = new Vrpc.Mapping();

    resultMapping.set(
      Vrpc.Variant.createString("repositoryPath"),
      Vrpc.Variant.createString(result.path),
    );

    resultMapping.set(
      Vrpc.Variant.createString("fileContent"),
      Vrpc.Variant.createString(result.fileContent ? result.fileContent : ""),
    );

    // return full path of the cloned repository with name
    return Vrpc.Variant.createMapping(resultMapping);
  }
}
