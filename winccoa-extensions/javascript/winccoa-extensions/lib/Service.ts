import { Vrpc, WinccoaManager } from "winccoa-manager";
import { AddOnHandler } from "./AddOnHandler";
import { AddonConfig } from "./AddonConfig";

const winccoa = new WinccoaManager();

export class ExtensionsService extends Vrpc.ServiceBase {
  private _addOnHandler: AddOnHandler;

  constructor() {
    super("Extensions");

    this.registerFunction("register", this.registerSubProjects.bind(this));
    this.registerFunction("unregister", this.unregisterSubProjects.bind(this));
    this.registerFunction(
      "subProjects",
      this.listRegisteredSubProjects.bind(this),
    );

    this.registerFunction("pull", this.pullRepository.bind(this));
    this.registerFunction("clone", this.cloneRepository.bind(this));
    this.registerFunction("remove", this.removeRepository.bind(this));
    this.registerFunction("listRepos", this.listRemoteRepositories.bind(this));
    this.registerFunction("repoPath", this.getDefaultAddonPath.bind(this));
    this.registerFunction("localRepos", this.listLocalAddOns.bind(this));
    this.registerFunction(
      "setPmonCredentials",
      this.setPmonCredentials.bind(this),
    );
    this.registerFunction(
      "verifyPmonCredentials",
      this.verifyPmonCredentials.bind(this),
    );
    this.registerFunction(
      "removePmonCredentials",
      this.removePmonCredentials.bind(this),
    );

    this._addOnHandler = new AddOnHandler();
  }

  /**
   * Parse JSON fileContent and map to AddonConfig
   * @param fileContent JSON string from package.winccoa.json
   * @returns AddonConfig object
   */
  private parseAndMapAddonConfig(fileContent: string): AddonConfig {
    try {
      const parsedContent = JSON.parse(fileContent);
      return this._addOnHandler.mapPackageJsonToAddonConfig(parsedContent);
    } catch (error) {
      throw new Error(`Invalid JSON in fileContent: ${error}`);
    }
  }

  private async registerSubProjects(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    try {
      winccoa.logDebugF(
        "addonHandler",
        "check if request is mapping:",
        request.isMapping(),
      );
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
      winccoa.logDebugF(
        "addonHandler",
        "-------- repositoryPath:",
        repositoryPath,
      );

      // Extract fileContent using requestMapping for the keys
      const fileContentVariant = requestMapping.get(
        Vrpc.Variant.createString("fileContent"),
      );
      if (!fileContentVariant) {
        throw new Error('Missing required "fileContent" parameter in mapping');
      }
      const fileContent = fileContentVariant.getString();
      winccoa.logDebugF("addonHandler", "-------- fileContent:", fileContent);

      const sessionVariant = requestMapping.get(
        Vrpc.Variant.createString("session"),
      );
      const session = sessionVariant ? sessionVariant.getString() : "";

      // Parse the JSON string and map to AddonConfig interface
      const config = this.parseAndMapAddonConfig(fileContent);

      winccoa.logDebugF(
        "addonHandler",
        "--------- Parsed addon configuration:",
        config,
      );

      // Process dependencies first
      if (config.Dependencies && config.Dependencies.length > 0) {
        winccoa.logDebugF(
          "addonHandler",
          `Installing ${config.Dependencies.length} dependencies before registering subprojects...`,
        );
        await this._addOnHandler.processDependencies(
          config.Dependencies,
          session,
        );
      }

      // Register each subproject
      const results: any[] = [];
      for (const subproject of config.Subprojects) {
        const result = await this._addOnHandler.registerSubProject(
          repositoryPath,
          subproject.Name,
          subproject,
          session,
        );
        results.push(result);
        winccoa.logDebugF(
          "addonHandler",
          `Sub-project ${subproject.Name} at ${repositoryPath} registered with result code:`,
          result,
        );
      }

      winccoa.logDebugF(
        "addonHandler",
        `All ${config.Subprojects.length} sub-projects registered successfully`,
      );
      return Vrpc.Variant.createBool(true);
    } catch (error) {
      winccoa.logWarning("Error in registerSubProjects:", error);
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
    winccoa.logDebugF(
      "addonHandler",
      "-------- repositoryPath:",
      repositoryPath,
    );

    // Extract if files shall be deleted
    const deleteFileVariant = requestMapping.get(
      Vrpc.Variant.createString("deleteFiles"),
    );
    if (!deleteFileVariant) {
      throw new Error('Missing required "deleteFiles" parameter in mapping');
    }
    const deleteFiles = deleteFileVariant.getBool();
    winccoa.logDebugF("addonHandler", "-------- deleteFiles:", deleteFiles);

    // Extract fileContent using requestMapping for the keys
    const fileContentVariant = requestMapping.get(
      Vrpc.Variant.createString("fileContent"),
    );
    if (!fileContentVariant) {
      throw new Error('Missing required "fileContent" parameter in mapping');
    }
    const fileContent = fileContentVariant.getString();
    winccoa.logDebugF("addonHandler", "-------- fileContent:", fileContent);

    // Parse the JSON string and map to AddonConfig interface
    const config = this.parseAndMapAddonConfig(fileContent);

    // Unregister each subproject
    for (const subproject of config.Subprojects) {
      const result = await this._addOnHandler.unregisterSubProject(
        repositoryPath,
        subproject.Name,
        deleteFiles,
        subproject,
      );
      winccoa.logDebugF(
        "addonHandler",
        `Sub-project ${subproject.Name} unregistered with result code:`,
        result,
      );
    }

    return Vrpc.Variant.createBool(true);
  }

  private async listRegisteredSubProjects(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    winccoa.logDebugF("addonHandler", "Listing registered sub-projects");
    const result = await this._addOnHandler.listSubProjects();
    winccoa.logDebugF(
      "addonHandler",
      "Registered sub-projects listed with result code:",
      result,
    );
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
    const requestMapping = request.getMapping();

    const repositoryPathVariant = requestMapping.get(
      Vrpc.Variant.createString("repositoryPath"),
    );
    if (!repositoryPathVariant) {
      throw new Error('Missing required "repositoryPath" parameter in mapping');
    }
    const repositoryPath = repositoryPathVariant.getString();

    const sessionVariant = requestMapping.get(
      Vrpc.Variant.createString("session"),
    );
    const session = sessionVariant ? sessionVariant.getString() : "";

    const result = await this._addOnHandler.pullRepository(
      repositoryPath,
      session,
    );

    const resultMapping = new Vrpc.Mapping();

    resultMapping.set(
      Vrpc.Variant.createString("repositoryPath"),
      Vrpc.Variant.createString(repositoryPath),
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

    const sessionVariant = requestMapping.get(
      Vrpc.Variant.createString("session"),
    );
    const session = sessionVariant ? sessionVariant.getString() : "";

    const result = await this._addOnHandler.cloneRepository(
      repositoryURL,
      targetDir,
      branch,
    );

    // Check for dependencies and process them
    if (result.fileContent) {
      try {
        const config = this.parseAndMapAddonConfig(result.fileContent);

        if (config.Dependencies && config.Dependencies.length > 0) {
          winccoa.logDebugF(
            "addonHandler",
            `Cloned repository has ${config.Dependencies.length} dependencies, cloning them...`,
          );
          await this._addOnHandler.processDependencies(
            config.Dependencies,
            session,
            undefined, // processedDeps - use default
            undefined, // currentRepoUrl - use default
            false, // registerSubprojects - CLONE ONLY
          );
        }
      } catch (error) {
        winccoa.logWarning(
          "Failed to parse package.winccoa.json or process dependencies:",
          error,
        );
        // Continue anyway - the clone was successful
      }
    }

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

  private async removeRepository(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const directory = request.getString();
    const result = await this._addOnHandler.removeRepository(directory);
    return Vrpc.Variant.createBool(result);
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
    const sessionVariant = requestMapping.get(
      Vrpc.Variant.createString("session"),
    );

    if (!userVariant || !passwordVariant || !sessionVariant) {
      throw new Error(
        'Missing required "user" or "password" parameter in mapping',
      );
    }

    this._addOnHandler.addPmonCredentials(
      sessionVariant.getString(),
      userVariant.getString(),
      passwordVariant.getString(),
    );

    return Vrpc.Variant.createBool(
      await this._addOnHandler.verifyPmonCredentials(
        sessionVariant.getString(),
      ),
    );
  }

  // eslint-disable-next-line require-await
  private async removePmonCredentials(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const session = request.getString();

    if (!session) {
      throw new Error('Missing required "session" parameter in mapping');
    }

    this._addOnHandler.removePmonCredentials(session);
    return Vrpc.Variant.createBool(true);
  }

  // eslint-disable-next-line require-await
  private async verifyPmonCredentials(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const session = request.getString();

    if (!session) {
      throw new Error('Missing required "session" parameter in mapping');
    }

    return Vrpc.Variant.createBool(
      await this._addOnHandler.verifyPmonCredentials(session),
    );
  }
}
