import { Vrpc } from "winccoa-manager";
import { AddOnHandler } from "./AddOnHandler";

export class MarketplaceService extends Vrpc.ServiceBase {
  private _addOnHandler: AddOnHandler;

  constructor() {
    super("Marketplace");

    this.registerFunction("register", this.registerSubProject.bind(this));
    this.registerFunction("unregister", this.unregisterSubProject.bind(this));
    this.registerFunction(
      "listProjects",
      this.listRegisteredSubProjects.bind(this),
    );

    this.registerFunction("pull", this.pullRepository.bind(this));
    this.registerFunction("clone", this.cloneRepository.bind(this));
    this.registerFunction("listRepos", this.listRemoteRepositories.bind(this));

    this._addOnHandler = new AddOnHandler();
  }

  private async registerSubProject(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    return Vrpc.Variant.createUndefined();
  }

  private async unregisterSubProject(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    return Vrpc.Variant.createUndefined();
  }

  private async listRegisteredSubProjects(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    return Vrpc.Variant.createUndefined();
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

    const mapping = request.getMapping();

    // Extract URL from mapping
    const urlVariant = mapping.get(Vrpc.Variant.createString("url"));
    if (!urlVariant) {
      throw new Error('Missing required "url" parameter in mapping');
    }
    repositoryURL = urlVariant.getString();

    // Extract optional parameters targetDirectory and branch from mapping
    const branchVariant = mapping.get(Vrpc.Variant.createString("branch"));
    const targetDirVariant = mapping.get(
      Vrpc.Variant.createString("targetDirectory"),
    );

    targetDir = targetDirVariant ? targetDirVariant.getString() : undefined;
    branch = branchVariant ? branchVariant.getString() : undefined;

    const repositoryPath = await this._addOnHandler.cloneRepositoryFromUrl(
      repositoryURL,
      targetDir,
      branch,
    );

    // return full path of the cloned repository with name
    return Vrpc.Variant.createString(repositoryPath);
  }
}
