import { Vrpc } from "winccoa-manager";
import { AddOnHandler, Manager } from "./AddOnHandler";
import * as pathModule from "path";

export class MarketplaceService extends Vrpc.ServiceBase {
  private _addOnHandler: AddOnHandler;

  constructor() {
    super("Marketplace");

    this.registerFunction("register", this.registerSubProjects.bind(this));
    this.registerFunction("unregister", this.unregisterSubProjects.bind(this));
    this.registerFunction(
      "subProjects",
      this.listRegisteredSubProjects.bind(this),
    );

    this.registerFunction("pull", this.pullRepository.bind(this));
    this.registerFunction("clone", this.cloneRepository.bind(this));
    this.registerFunction("listRepos", this.listRemoteRepositories.bind(this));
    this.registerFunction("repoPath", this.getDefaultAddonPath.bind(this));
    this.registerFunction("localRepos", this.listLocalAddOns.bind(this));
    this.registerFunction(
      "setPmonCredentials",
      this.setPmonCredentials.bind(this),
    );
    this._addOnHandler = new AddOnHandler();
  }

  private async registerSubProjects(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    try {
      console.log("check if request is mapping:", request.isMapping());
      const requestMapping = request.getMapping();

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

      // Parse the JSON string to get addon configurations
      let addonConfigs: any[];
      try {
        const parsedContent = JSON.parse(fileContent);
        // Handle both single object and array of objects
        addonConfigs = Array.isArray(parsedContent)
          ? parsedContent
          : [parsedContent];
      } catch (error) {
        throw new Error(`Invalid JSON in fileContent: ${error}`);
      }

      // Map each parsed config to AddonConfig interface
      const configs: import("./AddonConfig").AddonConfig[] = addonConfigs.map(
        (jsonConfig: any) => ({
          RepoName: jsonConfig.RepoName,
          Keywords: jsonConfig.Keywords,
          Subproject: jsonConfig.Subproject,
          Version: jsonConfig.Version,
          Description: jsonConfig.Description,
          OaVersion: jsonConfig.OaVersion,
          Managers: jsonConfig.Managers
            ? jsonConfig.Managers.map((manager: any) => ({
                Name: manager.Name || "",
                StartMode: manager.StartMode || "Unknown",
                Options: manager.Options || "",
              }))
            : [],
          Dplists: jsonConfig.Dplists || [],
          UpdateScripts: jsonConfig.UpdateScripts || [],
          UnInstallScripts: jsonConfig.UnInstallScripts || [],
        }),
      );

      console.log("--------- Parsed addon configurations:", configs);

      // Register each addon configuration
      const results: any[] = [];
      for (const config of configs) {
        const result = await this._addOnHandler.registerSubProject(
          repositoryPath,
          config.Subproject,
          config,
        );
        results.push(result);
        console.log(
          `Sub-project ${config.RepoName || "unnamed"} at ${repositoryPath} registered with result code:`,
          result,
        );
      }

      console.log(`All ${configs.length} sub-projects registered successfully`);
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
    const requestMapping = request.getMapping();

    // Extract repositoryPath using requestMapping for the keys
    const repositoryPathVariant = requestMapping.get(
      Vrpc.Variant.createString("repositoryPath"),
    );
    if (!repositoryPathVariant) {
      throw new Error('Missing required "repositoryPath" parameter in mapping');
    }
    const repositoryPath = repositoryPathVariant.getString();
    console.log("-------- repositoryPath:", repositoryPath);

    // Extract if files shall be deleted
    const deleteFileVariant = requestMapping.get(
      Vrpc.Variant.createString("deleteFiles"),
    );
    if (!deleteFileVariant) {
      throw new Error('Missing required "deleteFiles" parameter in mapping');
    }
    const deleteFiles = deleteFileVariant.getBool();
    console.log("-------- deleteFiles:", deleteFiles);

    // Extract fileContent using requestMapping for the keys
    const fileContentVariant = requestMapping.get(
      Vrpc.Variant.createString("fileContent"),
    );
    if (!fileContentVariant) {
      throw new Error('Missing required "fileContent" parameter in mapping');
    }
    const fileContent = fileContentVariant.getString();
    console.log("-------- fileContent:", fileContent);

    // Parse the JSON string to get addon configurations
    let addonConfigs: any[];
    try {
      const parsedContent = JSON.parse(fileContent);
      // Handle both single object and array of objects
      addonConfigs = Array.isArray(parsedContent)
        ? parsedContent
        : [parsedContent];
    } catch (error) {
      throw new Error(`Invalid JSON in fileContent: ${error}`);
    }

    // Map each parsed config to AddonConfig interface
    const configs: import("./AddonConfig").AddonConfig[] = addonConfigs.map(
      (jsonConfig: any) => ({
        RepoName: jsonConfig.RepoName,
        Keywords: jsonConfig.Keywords,
        Subproject: jsonConfig.Subproject,
        Version: jsonConfig.Version,
        Description: jsonConfig.Description,
        OaVersion: jsonConfig.OaVersion,
        Managers: jsonConfig.Managers
          ? jsonConfig.Managers.map((manager: any) => ({
              Name: manager.Name || "",
              StartMode: manager.StartMode || "Unknown",
              Options: manager.Options || "",
            }))
          : [],
        Dplists: jsonConfig.Dplists || [],
        UpdateScripts: jsonConfig.UpdateScripts || [],
        UnInstallScripts: jsonConfig.UnInstallScripts || [],
      }),
    );

    for (const config of configs) {
      const result = await this._addOnHandler.unregisterSubProject(
        repositoryPath,
        config.Subproject,
        deleteFiles,
        config,
      );
      console.log(
        `Sub-project ${config.Subproject} unregistered with result code:`,
        result,
      );
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

    const customReposData = this._addOnHandler.listCustomRepositories();
    const customRepos = customReposData.repositories;

    const repos = [...orgRepos, ...customRepos];

    return Vrpc.Variant.createString(JSON.stringify(repos));
  }

  private async pullRepository(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const directory = request.getString();

    const result = await this._addOnHandler.pullRepository(directory);

    const resultMapping = new Vrpc.Mapping();

    resultMapping.set(
      Vrpc.Variant.createString("repositoryPath"),
      Vrpc.Variant.createString(directory),
    );

    resultMapping.set(
      Vrpc.Variant.createString("changes"),
      Vrpc.Variant.createInt(result.changes),
    );

    resultMapping.set(
      Vrpc.Variant.createString("fileContent"),
      Vrpc.Variant.createString(result.fileContent ? result.fileContent : ""),
    );

    // return repository path, number of changes and file content
    return Vrpc.Variant.createMapping(resultMapping);
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

  private async getDefaultAddonPath(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const defaultPath = this._addOnHandler.getDefaultAddonPath();
    return Vrpc.Variant.createString(defaultPath);
  }

  private async listLocalAddOns(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const result = await this._addOnHandler.listLocalAddOns();
    return Vrpc.Variant.createString(JSON.stringify(result));
  }

  // eslint-disable-next-line require-await
  private async setPmonCredentials(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const requestMapping = request.getMapping();
    const userVariant = requestMapping.get(Vrpc.Variant.createString("user"));
    const passwordVariant = requestMapping.get(
      Vrpc.Variant.createString("password"),
    );

    if (!userVariant || !passwordVariant) {
      throw new Error(
        'Missing required "user" or "password" parameter in mapping',
      );
    }

    this._addOnHandler.setPmonUser(userVariant.getString());
    this._addOnHandler.setPmonPassword(passwordVariant.getString());
    return Vrpc.Variant.createBool(true);
  }
}
