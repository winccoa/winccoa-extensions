import { Vrpc } from "winccoa-manager";
import { GitHandler } from "./GitHandler";

export class MarketplaceService extends Vrpc.ServiceBase {
  private gitHandler: GitHandler;

  constructor() {
    super("Marketplace");

    this.registerFunction("pull", this.pull.bind(this));
    this.registerFunction("clone", this.clone.bind(this));
    this.registerFunction("listRepos", this.listRepos.bind(this));

    this.gitHandler = new GitHandler();
  }

  private async pull(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    return Vrpc.Variant.createUndefined();
  }

  private async clone(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {

    return Vrpc.Variant.createUndefined();
  }

  private async listRepos(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const orgRepos = await this.gitHandler.listOrganizationRepositories('winccoa', {
      type: 'public',
      sort: 'updated',
      direction: 'desc'
    });

    console.log("Fetched repositories:", orgRepos);

    return Vrpc.Variant.createString(orgRepos.toString());
  }
}
