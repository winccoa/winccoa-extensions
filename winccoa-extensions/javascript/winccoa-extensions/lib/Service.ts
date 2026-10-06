import { Vrpc, WinccoaManager } from "winccoa-manager";
import { AddonHandler } from "./AddonHandler";
import { AddonConfig } from "./AddonConfig";

const winccoa = new WinccoaManager();

export class ExtensionsService extends Vrpc.ServiceBase {
  private _addonHandler: AddonHandler;

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
    this.registerFunction("localRepos", this.listLocalAddons.bind(this));
    this.registerFunction(
      "listInstalledAddons",
      this.listInstalledAddons.bind(this),
    );
    this.registerFunction("readFile", this.readFile.bind(this));
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

    this._addonHandler = new AddonHandler();
  }

  /**
   * Run one-time startup tasks after the service is fully initialized.
   * Currently executes DbUpdateScripts for all registered extensions.
   */
  public async runStartupTasks(): Promise<void> {
    try {
      await this._addonHandler.executeStartupDbUpdateScripts();
    } catch (error) {
      winccoa.logWarning("Startup tasks encountered an error:", error);
      // Non-fatal: startup tasks should not prevent the service from running
    }
  }

  /**
   * Parse JSON fileContent and map to AddonConfig
   * For addons located in the WinCC OA installation directory (preinstalled
   * addons), a subproject entry without a name defaults to the addon's folder
   * name. Addons from external sources must define a name for every subproject.
   * @param fileContent JSON string from package.winccoa.json
   * @param repositoryPath Path of the repository root (detects the
   *   installation directory context for preinstalled addons)
   * @param repoName Name of the addon's folder (used as the default subproject
   *   name and in error messages)
   * @returns AddonConfig object
   */
  private parseAndMapAddonConfig(
    fileContent: string,
    repositoryPath: string,
    repoName: string,
  ): AddonConfig {
    let parsedContent: any;
    try {
      parsedContent = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(`Invalid JSON in fileContent: ${error}`);
    }

    let packageJson = parsedContent;

    // Preinstalled addons live directly in the WinCC OA installation
    // directory, whose path is passed as repository path during registration.
    // The addon's folder is the subproject itself, so it carries the name.
    if (this._addonHandler.isInstalledAddonPath(repositoryPath)) {
      const namelessSubprojects = (
        (parsedContent && parsedContent.Subprojects) ||
        []
      ).filter((sp: any) => !sp || !sp.Name);

      if (namelessSubprojects.length > 1) {
        throw new Error(
          `Addon "${repoName}" in the WinCC OA installation directory has ` +
            `${namelessSubprojects.length} subprojects without a "Name". ` +
            `Preinstalled addons are subprojects themselves and may define ` +
            `at most one subproject without a "Name" field.`,
        );
      }

      if (namelessSubprojects.length === 1) {
        if (!repoName) {
          throw new Error(
            'Missing "repoName" parameter required to resolve the subproject ' +
              `name of the installed addon at ${repositoryPath}`,
          );
        }

        packageJson = this._addonHandler.applyDefaultSubprojectName(
          packageJson,
          repoName,
        );
      }
    }

    return this._addonHandler.mapPackageJsonToAddonConfig(packageJson);
  }

  /**
   * Validate a repository path received from a client request. Only cloned
   * repositories (direct children of the default addon directory) and, if
   * allowed, the WinCC OA installation directory (preinstalled addons) are
   * accepted. For the installation directory the addon named by repoName must
   * exist there.
   * @param repositoryPath Path received from the request
   * @param repoName Folder name of the addon (required for preinstalled addons)
   * @param allowInstalled Whether the installation directory is accepted
   * @throws Error if the path is not allowed
   */
  private validateRepositoryPath(
    repositoryPath: string,
    repoName: string,
    allowInstalled: boolean,
  ): void {
    const validated = this._addonHandler.resolveAllowedRepositoryPath(
      repositoryPath,
      allowInstalled,
    );
    if (validated.installed) {
      this._addonHandler.assertInstalledAddonExists(repoName);
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

      // Extract the optional repository name (name of the addon's folder);
      // used as the default subproject name for preinstalled addons
      const repoNameVariant = requestMapping.get(
        Vrpc.Variant.createString("repoName"),
      );
      const repoName = repoNameVariant ? repoNameVariant.getString() : "";
      winccoa.logDebugF("addonHandler", "-------- repositoryName:", repoName);

      // Only cloned repositories and preinstalled addons may be registered
      this.validateRepositoryPath(repositoryPath, repoName, true);

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
      // (subprojects of preinstalled addons default to the addon's folder name)
      const config = this.parseAndMapAddonConfig(
        fileContent,
        repositoryPath,
        repoName,
      );

      // Subprojects of addons from external sources must define a name,
      // since a single repository may contain multiple subprojects
      this._addonHandler.assertSubprojectNamesPresent(
        config,
        repoName || repositoryPath,
      );

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
        await this._addonHandler.processDependencies(
          config.Dependencies,
          session,
        );
      }

      // Register each subproject
      const results: any[] = [];
      for (const subproject of config.Subprojects) {
        const result = await this._addonHandler.registerSubProject(
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

    // Extract the optional repository name (name of the addon's folder);
    // used as the default subproject name for preinstalled addons
    const repoNameVariant = requestMapping.get(
      Vrpc.Variant.createString("repoName"),
    );
    const repoName = repoNameVariant ? repoNameVariant.getString() : "";
    winccoa.logDebugF("addonHandler", "-------- repositoryName:", repoName);

    // Only cloned repositories and preinstalled addons may be unregistered
    // (and, for cloned repositories, deleted)
    this.validateRepositoryPath(repositoryPath, repoName, true);

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
    // (subprojects of preinstalled addons default to the addon's folder name)
    const config = this.parseAndMapAddonConfig(
      fileContent,
      repositoryPath,
      repoName,
    );

    // Subprojects of addons from external sources must define a name,
    // since a single repository may contain multiple subprojects
    this._addonHandler.assertSubprojectNamesPresent(
      config,
      repoName || repositoryPath,
    );

    // Unregister each subproject
    for (const subproject of config.Subprojects) {
      const result = await this._addonHandler.unregisterSubProject(
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
    const result = await this._addonHandler.listSubProjects();
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

    const orgRepos = await this._addonHandler.listOrganizationRepositories(
      organizationName,
      {
        type: "public",
        sort: "updated",
        direction: "desc",
      },
    );

    const customReposData = this._addonHandler.listCustomRepositories();
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

    // Only cloned repositories can be pulled (not preinstalled addons)
    this.validateRepositoryPath(repositoryPath, "", false);

    const sessionVariant = requestMapping.get(
      Vrpc.Variant.createString("session"),
    );
    const session = sessionVariant ? sessionVariant.getString() : "";

    const result = await this._addonHandler.pullRepository(
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

    const result = await this._addonHandler.cloneRepository(
      repositoryURL,
      targetDir,
      branch,
    );

    // Check for dependencies and process them
    // (clone context: the repository is always cloned into the project
    // directory, so no default subproject name applies here and nameless
    // subprojects are only rejected later at install time)
    if (result.fileContent) {
      try {
        const config = this.parseAndMapAddonConfig(result.fileContent, "", "");

        if (config.Dependencies && config.Dependencies.length > 0) {
          winccoa.logDebugF(
            "addonHandler",
            `Cloned repository has ${config.Dependencies.length} dependencies, cloning them...`,
          );
          await this._addonHandler.processDependencies(
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
    // Only cloned repositories can be removed; the handler additionally
    // refuses to delete anything outside of the addon directory
    this.validateRepositoryPath(directory, "", false);
    const result = await this._addonHandler.removeRepository(directory);
    return Vrpc.Variant.createBool(result);
  }

  private async getDefaultAddonPath(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const defaultPath = this._addonHandler.getDefaultAddonPath();
    return Vrpc.Variant.createString(defaultPath);
  }

  private async listLocalAddons(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const result = await this._addonHandler.listLocalAddons();
    return Vrpc.Variant.createString(JSON.stringify(result));
  }

  private async listInstalledAddons(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const result = await this._addonHandler.listInstalledAddons();
    return Vrpc.Variant.createString(JSON.stringify(result));
  }

  // eslint-disable-next-line require-await
  private async readFile(
    serverContext: Vrpc.ServerContext,
    request: Vrpc.Variant,
  ): Promise<Vrpc.Variant> {
    const requestMapping = request.getMapping();
    const filePathVariant = requestMapping.get(
      Vrpc.Variant.createString("filePath"),
    );

    if (!filePathVariant) {
      return Vrpc.Variant.createBool(false);
    }

    const filePath = filePathVariant.getString();
    const content = this._addonHandler.readFile(filePath);

    if (content === null) {
      return Vrpc.Variant.createBool(false);
    }

    return Vrpc.Variant.createString(content);
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

    this._addonHandler.addPmonCredentials(
      sessionVariant.getString(),
      userVariant.getString(),
      passwordVariant.getString(),
    );

    return Vrpc.Variant.createBool(
      await this._addonHandler.verifyPmonCredentials(
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

    this._addonHandler.removePmonCredentials(session);
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
      await this._addonHandler.verifyPmonCredentials(session),
    );
  }
}
