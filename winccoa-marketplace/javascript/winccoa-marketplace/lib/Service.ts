import { Vrpc } from "winccoa-manager";

export class MarketplaceService extends Vrpc.ServiceBase {
  constructor() {
    super("Marketplace");

    this.registerFunction("pull", this.pull.bind(this));
    this.registerFunction("clone", this.clone.bind(this));
    this.registerFunction("listRepos", this.listRepos.bind(this));
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
    return Vrpc.Variant.createUndefined();
  }
}
