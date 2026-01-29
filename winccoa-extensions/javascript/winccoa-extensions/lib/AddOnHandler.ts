import { Octokit } from "@octokit/rest";
import { execSync } from "child_process";
import { simpleGit } from "simple-git";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  WinccoaCtrlScript,
  WinccoaCtrlType,
  WinccoaManager,
} from "winccoa-manager";
import { AsciiManager } from "./AsciiManager";
import { CommandExecutor } from "./CommandExecutor";
import { PathResolver } from "./PathResolver";
import { NodeInstaller } from "./NodeInstaller";
import { AddonConfig, SubprojectConfig } from "./AddonConfig";

/**
 * Interface for manager configuration
 */
export interface Manager {
  exeName: string;
  startParams: string;
}

export interface PmonCredentials {
  session: string;
  user: string;
  password: string;
}

// Export the class for use in other modules
export { AddOnHandler };

/**
 * WinCC OA AddOn Handler for managing GitHub repositories
 *
 * SECURE AUTHENTICATION:
 *
 * Environment Variables (Best for Production & WinCC OA):
 *    - Set: GITHUB_TOKEN=ghp_your_token_here
 *    - const handler = new AddOnHandler(); // Auto-detects token
 *    - Keeps tokens out of source code
 *    - Secure for scripts and CI/CD
 *    - Perfect for WinCC OA integration
 *
 * How to Create Personal Access Token:
 *    1. GitHub.com > Settings > Developer settings > Personal access tokens
 *    2. Click "Generate new token (classic)"
 *    3. Select scopes: "repo" (private) or "public_repo" (public only)
 *    4. Copy token immediately (shown only once)
 *
 * Environment Variable Setup:
 *    Windows PowerShell: $env:GITHUB_TOKEN="ghp_your_token_here"
 *    Windows CMD: set GITHUB_TOKEN=ghp_your_token_here
 *    Linux/Mac: export GITHUB_TOKEN="ghp_your_token_here"
 *
 * Authentication Benefits:
 *    - Access private repositories
 *    - Higher rate limits (5000 vs 60 requests/hour)
 *    - Access to organization repositories
 *    - Full GitHub API functionality
 */

const winccoa = new WinccoaManager();

/**
 * Read a specific value from Windows registry
 * @param keyPath Registry key path
 * @param valueName Optional specific value name to read
 * @returns Registry value or null if not found
 */
function readWindowsRegistry(
  keyPath: string,
  valueName?: string,
): string | null {
  try {
    if (os.platform() !== "win32") {
      return null;
    }

    let regCommand = `reg query "${keyPath}"`;
    if (valueName) {
      regCommand += ` /v "${valueName}"`;
    }

    const output = execSync(regCommand, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000, // 5 second timeout
    });

    if (valueName) {
      // Parse specific value
      const valueMatch = output.match(
        new RegExp(`${valueName}\\s+REG_\\w+\\s+(.+)`, "i"),
      );
      if (valueMatch && valueMatch[1]) {
        return valueMatch[1].trim();
      }
    } else {
      // Return the entire output for manual parsing
      return output;
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Generic function to read WinCC OA registry values with consistent error handling
 * @param valueName The registry value name to read (e.g., "PROJECTDIR", "INSTALLDIR")
 * @param description Human-readable description for logging
 * @returns Registry value or null if not found/invalid
 */
function getWinCCOARegistryValue(
  valueName: string,
  description: string,
): string | null {
  if (os.platform() !== "win32") {
    winccoa.logWarning(
      "addonHandler",
      `Not running on Windows, ${description} registry lookup skipped`,
    );
    return null;
  }

  try {
    const registryPath = "HKEY_LOCAL_MACHINE\\SOFTWARE\\ETM\\WinCC_OA\\3.21";
    winccoa.logDebugF(
      "addonHandler",
      `Checking Windows registry for ${description}: ${registryPath}`,
    );

    const registryValue = readWindowsRegistry(registryPath, valueName);
    if (registryValue && fs.existsSync(registryValue)) {
      winccoa.logDebugF(
        "addonHandler",
        `Found WinCC OA ${description} from registry: ${registryValue}`,
      );
      return registryValue;
    }

    winccoa.logWarning(`No valid WinCC OA ${description} found in registry`);
    return null;
  } catch (error) {
    winccoa.logWarning(
      `Failed to read ${description} from registry:`,
      (error as Error).message,
    );
    return null;
  }
}

/**
 * Get the target clone directory from extensions.config.json storePath, Windows registry, or fall back to current directory
 * Priority order:
 * 1. storePath from extensions.config.json (if exists and is a valid directory)
 * 2. Windows registry PROJECTDIR key
 * 3. Current working directory
 */
function getDefaultProjDir(): string {
  // First, try to read storePath from extensions.config.json
  try {
    const configPath = path.resolve(
      __dirname,
      "../../../config/extensions.config.json",
    );
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(fileContent);

      if (config.storePath && typeof config.storePath === "string") {
        // Check if the storePath exists and is a directory
        if (
          fs.existsSync(config.storePath) &&
          fs.statSync(config.storePath).isDirectory()
        ) {
          winccoa.logDebugF(
            "addonHandler",
            `Using storePath from extensions.config.json: ${config.storePath}`,
          );
          return config.storePath;
        } else {
          winccoa.logWarning(
            `storePath from extensions.config.json does not exist or is not a directory: ${config.storePath}`,
          );
        }
      }
    }
  } catch (error) {
    winccoa.logDebugF(
      "addonHandler",
      `Could not read storePath from extensions.config.json: ${(error as Error).message}`,
    );
  }

  // Fall back to Windows registry
  // TODO: check how to read on linux -> pvssInst.conf
  const projDir = getWinCCOARegistryValue("PROJECTDIR", "PROJECTDIR");
  return projDir || process.cwd();
}

/**
 * Get the WinCC OA installation directory using multiple methods
 * 1. Try WinCC OA manager API (preferred)
 * 2. Fallback to Windows registry INSTALLDIR key
 * 3. Fallback to environment variables (PVSS_INSTALL_BASE)
 */
function getWinCCOAInstallDir(winccoa: WinccoaManager): string | null {
  try {
    // Method 1: Use WinCC OA manager API (preferred)
    if (winccoa) {
      const installPath = PathResolver.getInstallationPath(winccoa);
      if (installPath && fs.existsSync(installPath)) {
        winccoa.logDebugF(
          "addonHandler",
          `Found WinCC OA installation directory via API: ${installPath}`,
        );
        return installPath;
      }
      winccoa.logWarning(
        "WinCC OA API did not return a valid installation path",
      );
    } else {
      console.error("No WinCC OA manager instance available for API query");
    }

    // Method 2: Windows Registry (fallback)
    const installDir = getWinCCOARegistryValue(
      "INSTALLDIR",
      "installation directory",
    );
    if (installDir) {
      return installDir;
    }

    // Method 3: Environment variables (additional fallback)
    const envInstallBase = process.env.PVSS_INSTALL_BASE;
    if (envInstallBase && fs.existsSync(envInstallBase)) {
      winccoa.logDebugF(
        "addonHandler",
        `Found WinCC OA installation directory from environment: ${envInstallBase}`,
      );
      return envInstallBase;
    }

    winccoa.logWarning("Could not determine WinCC OA installation directory");
    return null;
  } catch (error) {
    winccoa.logWarning(
      "Error while determining WinCC OA installation directory:",
      (error as Error).message,
    );
    return null;
  }
}

class AddOnHandler {
  private octokit: Octokit;
  private isAuthenticated: boolean = false;
  private _defaultDirectory: string;
  private _oaVersion: string;
  private pmonCredentials: PmonCredentials[] = [];

  constructor() {
    // Initialize octokit without authentication first - suppress HTTP error logging
    this.octokit = new Octokit({
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    this.isAuthenticated = false;

    // Get WinCC OA version
    const details = winccoa.getVersionInfo();
    this._oaVersion =
      details.winccoa.major +
      "." +
      details.winccoa.minor +
      "." +
      details.winccoa.patch;
    winccoa.logDebugF(
      "addonHandler",
      `Detected WinCC OA version: ${this._oaVersion}`,
    );

    // Get WinCC OA default project directory
    this._defaultDirectory = getDefaultProjDir();

    // Setup authentication synchronously
    this.setupSyncAuthentication();
  }

  /**
   * Setup synchronous authentication (Token method only)
   */
  private setupSyncAuthentication(): void {
    try {
      const authMethods = this.getSupportedAuthMethods();

      winccoa.logInfo("auth methods", authMethods);

      if (authMethods.length === 0) {
        winccoa.logInfo(
          "addonHandler",
          "No authentication methods configured - using public access only",
        );
        return;
      }

      winccoa.logInfo(
        "addonHandler",
        `Configured authentication methods: ${authMethods.join(", ")}`,
      );

      // Check if Token method is available
      const hasToken = authMethods.includes("Token");

      if (hasToken) {
        // Check for Token authentication using multiple sources
        const authToken = this.readGitHubToken();
        if (authToken) {
          winccoa.logInfo(
            "addonHandler",
            "Using GitHub token for authentication (Token method)",
          );
          this.octokit = new Octokit({
            auth: authToken,
            log: {
              debug: () => {},
              info: () => {},
              warn: () => {},
              error: () => {},
            },
          });
          this.isAuthenticated = true;
          return;
        } else {
          winccoa.logWarning(
            "addonHandler",
            "Token authentication configured but no GitHub token found",
          );
          winccoa.logWarning(
            "addonHandler",
            "To authenticate, use one of these methods:",
          );
          winccoa.logWarning(
            "addonHandler",
            "   - Set GITHUB_TOKEN environment variable",
          );
          winccoa.logWarning(
            "addonHandler",
            '   - Create .env file in workspace root with GITHUB_TOKEN="your_token"',
          );
        }
      }
    } catch (error) {
      winccoa.logWarning("Error setting up authentication:", error);
      winccoa.logInfo("addonHandler", "Using public access only");
    }
  }

  /**
   * Get authentication status
   * @returns boolean indicating if handler is authenticated
   */
  isAuthenticatedUser(): boolean {
    return this.isAuthenticated;
  }

  getDefaultAddonPath(): string {
    return this._defaultDirectory;
  }

  addPmonCredentials(session: string, user: string, password: string): void {
    this.pmonCredentials.push({ session, user, password });
  }

  removePmonCredentials(session: string): void {
    this.pmonCredentials = this.pmonCredentials.filter(
      (cred) => cred.session !== session,
    );
  }

  async verifyPmonCredentials(session: string): Promise<boolean> {
    let user: string = "",
      password: string = "";
    const credentials = this.pmonCredentials.find(
      (cred) => cred.session === session,
    );
    if (credentials) {
      user = credentials.user;
      password = credentials.password;
    }

    const pmonPath = await this.ctrlScript.start("getPmonPath");

    const configFilePath = await this.ctrlScript.start("getConfigFilePath");

    const result = await CommandExecutor.execute(
      `"${pmonPath}" -config "${configFilePath}" -auth "${user}" "${password}" "${user}" "${password}"`,
    );

    return result.exitCode == 0;
  }

  /**
   * Read GitHub token from multiple sources in order of preference:
   * 1. Environment variable GITHUB_TOKEN
   * 2. .env file in workspace root
   * @returns The token string or null if not found
   */
  private readGitHubToken(): string | null {
    // Try environment variable first
    const envToken = process.env.GITHUB_TOKEN;
    if (envToken) {
      winccoa.logInfo(
        "addonHandler",
        "Found GITHUB_TOKEN in environment variable",
      );
      return envToken;
    }

    // Try .env file in workspace root
    try {
      // From lib/AddOnHandler.js, go up to workspace root: lib -> winccoa-extensions -> javascript -> winccoa-extensions -> github_integration
      const envPath = path.resolve(__dirname, "../../../../.env");
      winccoa.logDebugF("addonHandler", `Looking for .env file at: ${envPath}`);
      if (fs.existsSync(envPath)) {
        winccoa.logDebugF("addonHandler", `.env file found at: ${envPath}`);
        const envContent = fs.readFileSync(envPath, "utf8");
        const lines = envContent.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("GITHUB_TOKEN=")) {
            const token = trimmed
              .substring("GITHUB_TOKEN=".length)
              .replace(/['"]/g, "");
            if (token && token !== "your_token_here") {
              winccoa.logInfo(
                "addonHandler",
                "Found GITHUB_TOKEN in .env file",
              );
              return token;
            } else if (token === "your_token_here") {
              winccoa.logInfo(
                "addonHandler",
                ".env file contains placeholder token - ignoring",
              );
            } else {
              winccoa.logInfo(
                "addonHandler",
                ".env file contains empty token - ignoring",
              );
            }
          }
        }
      } else {
        winccoa.logDebugF("addonHandler", `.env file NOT found at: ${envPath}`);
      }
    } catch (error) {
      winccoa.logInfo("addonHandler", "Could not read .env file");
    }

    winccoa.logInfo("addonHandler", "GITHUB_TOKEN not found in any source");
    return null;
  }

  /**
   * Authenticate with GitHub using a personal access token
   * Uses multiple sources to find GITHUB_TOKEN for secure authentication
   * @returns Promise<boolean> indicating success/failure
   */
  async authenticateWithToken(): Promise<boolean> {
    try {
      // Check for token from multiple sources
      const authToken = this.readGitHubToken();

      if (!authToken) {
        winccoa.logWarning(
          "addonHandler",
          "No GitHub token found in any source",
        );
        return false;
      }

      // Test the token by creating a new Octokit instance
      const testOctokit = new Octokit({
        auth: authToken,
        log: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      });

      try {
        await testOctokit.rest.users.getAuthenticated();

        // If successful, update the main instance
        this.octokit = testOctokit;
        this.isAuthenticated = true;

        winccoa.logDebugF(
          "addonHandler",
          "GitHub token authentication successful!",
        );
        return true;
      } catch (tokenError: unknown) {
        winccoa.logWarning(
          "Invalid GitHub token:",
          (tokenError as Error).message,
        );
        return false;
      }
    } catch (error: unknown) {
      winccoa.logWarning("Token authentication failed:", error);
      return false;
    }
  }

  private readonly ctrlScript: WinccoaCtrlScript = new WinccoaCtrlScript(
    winccoa,
    `
#uses "CtrlPv2Admin"
#uses "classes/projectEnvironment/ProjEnvProject"
#uses "pmon"

string getPmonPath()
{
  string sPvssPath;
  paGetProjAttr(PROJ, "pvss_path", sPvssPath);
  return makeNativePath(sPvssPath + "/bin/" + getComponentName(PMON_COMPONENT));
}

string getConfigFilePath()
{
  string config;
  paProjName2ConfigFile(PROJ, config);
  return config;
}

string getProjectName()
{
  return PROJ;
}

int registerSubProj(string path, string projName)
{
  int ret = paRegProj(projName, path, "", 0, true);
  DebugTN("------- CTRL", path, projName, ret);

  if (ret < 0)
  {
    return ret;
  }

  dyn_string subProjects;
  paGetSubProjs(PROJ, subProjects);

  if (!subProjects.contains(projName))
  {
    subProjects.append(projName);
    paSetSubProjs(PROJ, subProjects);
  }

  return ret;
}

int unregisterSubProj(string path, string projName, bool deleteFiles)
{
  dyn_string subProjects;

  DebugTN("------- CTRL", path, projName, deleteFiles);

  paGetSubProjs(PROJ, subProjects);

  if (subProjects.contains(projName))
  {
    int idx = subProjects.indexOf(projName, 0);
    subProjects.removeAt(idx);
    paSetSubProjs(PROJ, subProjects);
  }

  return paDelProj(projName, deleteFiles);
}

dyn_string listSubProjs()
{
  dyn_string subProjects;
  paGetSubProjs(PROJ, subProjects);
  return subProjects;
}

int gTcpFileDescriptor2;
string host;
string port;
bool addManager(string manager, string startMode, string options, string user, string pwd)
{
  DebugTN("Adding manager", manager, startMode, options, user, pwd);
  paGetProjHostPort(PROJ, host, port);
  gTcpFileDescriptor2 = tcpOpen(host, port);
  ProjEnvProject proj  = new ProjEnvProject(PROJ);
  dyn_anytype managers = proj.getListOfManagersStati();
  bool err;
  
  pmonInsertManager(err, PROJ, dynlen(managers), makeDynString(manager, startMode, 2, 2, 30, options), user, pwd);
  return err;
}


int managerExists(string manager, string options)
{
  ProjEnvProject proj  = new ProjEnvProject(PROJ);
  dyn_anytype managerOptions = proj.getListOfManagerOptions();

  bool exists;

  for (int i = 0; i < dynlen(managerOptions); i++)
  {
    ProjEnvManagerOptions managerOption = managerOptions[i + 1];
    if (managerOption.component == manager && managerOption.startOptions == options)
      return i;
  }
  return -1;
}

void restartManager(int manIdx)
{
  ProjEnvProject proj  = new ProjEnvProject(PROJ);
  proj.stopManager(manIdx, 30);
  proj.startManager(manIdx);
}

void removeManager(int manIdx)
{
  ProjEnvProject proj  = new ProjEnvProject(PROJ);
  string startOptions;
  proj.stopManager(manIdx, 30);
  proj.deleteManager(manIdx);
}
  `,
  );

  /**
   * Process and install dependencies recursively
   * @param dependencies Array of git repository URLs
   * @param session Session ID for credentials
   * @param processedDeps Set of already processed dependencies to avoid circular dependencies
   * @param currentRepoUrl Optional URL of the current repository to prevent self-dependency
   * @param registerSubprojects Whether to register subprojects (true) or just clone (false)
   */
  async processDependencies(
    dependencies: string[],
    session: string,
    processedDeps: Set<string> = new Set(),
    currentRepoUrl?: string,
    registerSubprojects: boolean = true,
  ): Promise<void> {
    if (!dependencies || dependencies.length === 0) {
      return;
    }

    winccoa.logDebugF(
      "addonHandler",
      `Processing ${dependencies.length} dependencies (${registerSubprojects ? "clone and register" : "clone only"})...`,
    );

    for (const depUrl of dependencies) {
      // Normalize URLs for comparison (remove .git suffix, trailing slashes, etc.)
      const normalizedDepUrl = depUrl.replace(/\.git$/, "").replace(/\/$/, "");
      const normalizedCurrentUrl = currentRepoUrl
        ? currentRepoUrl.replace(/\.git$/, "").replace(/\/$/, "")
        : "";

      // Skip if dependency is the same as current repository (self-dependency)
      if (normalizedCurrentUrl && normalizedDepUrl === normalizedCurrentUrl) {
        winccoa.logWarning(
          `Skipping self-dependency: Repository ${depUrl} cannot depend on itself`,
        );
        continue;
      }

      // Skip if already processed (avoid circular dependencies)
      if (processedDeps.has(depUrl)) {
        winccoa.logDebugF(
          "addonHandler",
          `Dependency ${depUrl} already processed, skipping...`,
        );
        continue;
      }

      winccoa.logDebugF("addonHandler", `Installing dependency: ${depUrl}`);
      processedDeps.add(depUrl);

      try {
        // Clone the dependency repository
        const cloneResult = await this.cloneRepository(depUrl);

        if (!cloneResult.fileContent) {
          winccoa.logWarning(
            `Dependency ${depUrl} does not have a package.winccoa.json file, skipping registration...`,
          );
          continue;
        }

        // Parse the dependency's package.winccoa.json
        const depConfig = this.mapPackageJsonToAddonConfig(
          JSON.parse(cloneResult.fileContent),
        );

        // Recursively process nested dependencies
        if (depConfig.Dependencies && depConfig.Dependencies.length > 0) {
          await this.processDependencies(
            depConfig.Dependencies,
            session,
            processedDeps,
            depUrl, // Pass current dependency URL to prevent self-dependency
            registerSubprojects, // Pass the flag recursively
          );
        }

        // Register all subprojects of the dependency (only if registerSubprojects is true)
        if (registerSubprojects) {
          for (const subproject of depConfig.Subprojects) {
            winccoa.logDebugF(
              "addonHandler",
              `Registering dependency subproject: ${subproject.Name}`,
            );
            await this.registerSubProject(
              cloneResult.path,
              subproject.Name,
              subproject,
              session,
            );
          }
        } else {
          winccoa.logDebugF(
            "addonHandler",
            `Skipping registration for dependency: ${depUrl} (clone only mode)`,
          );
        }

        winccoa.logDebugF(
          "addonHandler",
          `Dependency ${depUrl} installed successfully`,
        );
      } catch (error) {
        winccoa.logWarning(`Failed to install dependency ${depUrl}:`, error);
        throw new Error(
          `Dependency installation failed for ${depUrl}: ${error}`,
        );
      }
    }

    winccoa.logDebugF(
      "addonHandler",
      "All dependencies processed successfully",
    );
  }

  async registerSubProject(
    repoPath: string,
    projectName: string,
    subprojectConfig: SubprojectConfig,
    session: string,
  ): Promise<number> {
    const ret = (await this.ctrlScript.start(
      "registerSubProj",
      [repoPath, projectName],
      [WinccoaCtrlType.string, WinccoaCtrlType.string],
    )) as number;

    await NodeInstaller.installAndBuild(path.join(repoPath, projectName));

    // Import dplist files if available (from subproject config)
    if (
      subprojectConfig.Dplists &&
      Array.isArray(subprojectConfig.Dplists) &&
      subprojectConfig.Dplists.length > 0
    ) {
      winccoa.logDebugF(
        "addonHandler",
        `Importing ${subprojectConfig.Dplists.length} dplist file(s)...`,
      );
      await this.importAsciiFiles(
        subprojectConfig.Dplists,
        path.join(repoPath, projectName, "dplist"),
      );
    } else {
      winccoa.logDebugF("addonHandler", "No dplist files to import");
    }

    const sessionCredentials = this.pmonCredentials.find(
      (cred) => cred.session === session,
    );
    const pmonUser = sessionCredentials?.user || "";
    const pmonPassword = sessionCredentials?.password || "";

    // Add managers from subproject config
    for (const manager of subprojectConfig.Managers || []) {
      winccoa.logDebugF(
        "addonHandler",
        `Adding manager ${manager.Name} with start mode ${manager.StartMode} and options ${manager.Options}`,
      );
      // eslint-disable-next-line no-await-in-loop
      await this.ctrlScript.start(
        "addManager",
        [
          manager.Name,
          manager.StartMode.toLowerCase(),
          manager.Options,
          pmonUser,
          pmonPassword,
        ],
        [
          WinccoaCtrlType.string,
          WinccoaCtrlType.string,
          WinccoaCtrlType.string,
          WinccoaCtrlType.string,
          WinccoaCtrlType.string,
        ],
      );
    }
    return ret;
  }

  async unregisterSubProject(
    repoPath: string,
    projectName: string,
    deleteFiles: boolean,
    subprojectConfig?: SubprojectConfig,
  ): Promise<number> {
    // Execute uninstall scripts if available (from subproject config)
    if (
      subprojectConfig &&
      subprojectConfig.UninstallScripts &&
      subprojectConfig.UninstallScripts.length > 0
    ) {
      winccoa.logInfo(
        `Executing ${subprojectConfig.UninstallScripts.length} uninstall script(s)...`,
      );

      // Create a timeout promise that rejects after 5 minutes
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(
          () => {
            reject(
              new Error(
                "Uninstall scripts execution timed out after 5 minutes",
              ),
            );
          },
          5 * 60 * 1000,
        ); // 5 minutes in milliseconds
      });

      // Race the execution against the timeout
      try {
        await Promise.race([
          this.executeScripts(
            path.join(repoPath, projectName),
            subprojectConfig.UninstallScripts,
          ),
          timeoutPromise,
        ]);
        winccoa.logInfo("Uninstall scripts completed successfully");
      } catch (error) {
        if (error instanceof Error && error.message.includes("timed out")) {
          winccoa.logWarning(
            "Uninstall scripts execution timed out after 5 minutes",
          );
        } else {
          winccoa.logWarning("Error executing uninstall scripts:", error);
        }
        // Continue with unregistration even if scripts fail
        winccoa.logInfo(
          "Continuing with project unregistration despite script errors",
        );
      }
    } else {
      winccoa.logInfo("No uninstall scripts to execute");
    }

    const ret = (await this.ctrlScript.start(
      "unregisterSubProj",
      [repoPath, projectName, deleteFiles],
      [WinccoaCtrlType.string, WinccoaCtrlType.string, WinccoaCtrlType.bool],
    )) as number;

    // delete the whole cloned repository folder
    winccoa.logDebugF("addonHandler", `deleteFiles = ${deleteFiles} `);
    if (deleteFiles) {
      winccoa.logDebugF(
        "addonHandler",
        `Deleting cloned repository folder: ${repoPath}`,
      );
      await fs.promises.rm(repoPath, { recursive: true, force: true });
    }

    return ret;
  }

  async removeRepository(repoPath: string): Promise<boolean> {
    winccoa.logDebugF(
      "addonHandler",
      `Removing local repository folder: ${repoPath}`,
    );
    try {
      await fs.promises.rm(repoPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      winccoa.logWarning(
        `Failed to remove local repository folder: ${(error as Error).message}`,
      );
      return false;
    }
  }

  async listSubProjects(): Promise<string[]> {
    return (await this.ctrlScript.start("listSubProjs")) as string[];
  }

  async listLocalAddOns(): Promise<{ addon: string; fileContent: string }[]> {
    const localAddOns: { addon: string; fileContent: string }[] = [];
    if (!fs.existsSync(this._defaultDirectory)) {
      return localAddOns;
    }
    const entries = await fs.promises.readdir(this._defaultDirectory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const addonJsonPath = path.join(
          this._defaultDirectory,
          entry.name,
          "package.winccoa.json",
        );
        if (fs.existsSync(addonJsonPath)) {
          const fileContent = fs.readFileSync(addonJsonPath, "utf-8");
          const jsonContent = JSON.parse(fileContent);
          localAddOns.push({ addon: entry.name, fileContent: jsonContent });
        }
      }
    }
    return localAddOns;
  }

  /**
   * Clone a repository using simple-git with complete URL
   * @param cloneUrl Complete git URL (HTTPS or SSH)
   * @param targetDirectory Optional target directory name
   * @param branch Optional branch to clone
   * @returns Object containing the full path to the cloned repository and package.winccoa.json content
   */
  async cloneRepository(
    cloneUrl: string,
    targetDirectory?: string,
    branch?: string,
  ): Promise<{ path: string; fileContent: string | null }> {
    try {
      // Determine the target directory and repository name
      let fullPath: string;
      let repoName: string;

      if (targetDirectory) {
        // If targetDirectory is provided, use it as-is (could be absolute or relative)
        if (path.isAbsolute(targetDirectory)) {
          // Absolute path provided
          if (
            fs.existsSync(targetDirectory) &&
            fs.statSync(targetDirectory).isDirectory()
          ) {
            // Path exists and is a directory - check if it's already a git repo
            const gitDir = path.join(targetDirectory, ".git");
            if (fs.existsSync(gitDir)) {
              // It's already a git repository, use it as-is
              fullPath = targetDirectory;
              repoName = path.basename(targetDirectory);
            } else {
              // It's a regular directory, append repo name to it
              repoName = this.extractRepoNameFromUrl(cloneUrl);
              fullPath = path.join(targetDirectory, repoName);
            }
          } else {
            // Path doesn't exist or is not a directory, use it as-is
            fullPath = targetDirectory;
            repoName = path.basename(targetDirectory);
          }
        } else {
          // Relative path provided, resolve from current working directory
          const resolvedPath = path.resolve(targetDirectory);
          if (
            fs.existsSync(resolvedPath) &&
            fs.statSync(resolvedPath).isDirectory()
          ) {
            // Path exists and is a directory - check if it's already a git repo
            const gitDir = path.join(resolvedPath, ".git");
            if (fs.existsSync(gitDir)) {
              // It's already a git repository, use it as-is
              fullPath = resolvedPath;
              repoName = path.basename(resolvedPath);
            } else {
              // It's a regular directory, append repo name to it
              repoName = this.extractRepoNameFromUrl(cloneUrl);
              fullPath = path.join(resolvedPath, repoName);
            }
          } else {
            // Path doesn't exist or is not a directory, use it as-is
            fullPath = resolvedPath;
            repoName = path.basename(resolvedPath);
          }
        }
      } else {
        // No target directory provided, extract repo name from URL and use _defaultDirectory
        repoName = this.extractRepoNameFromUrl(cloneUrl);
        fullPath = path.resolve(this._defaultDirectory, repoName);
      }

      winccoa.logDebugF("addonHandler", `Target directory: ${fullPath}`);

      // Check if repository already exists locally
      if (fs.existsSync(fullPath)) {
        winccoa.logDebugF(
          "addonHandler",
          `\nRepository already exists at: ${fullPath}`,
        );
        winccoa.logDebugF(
          "addonHandler",
          "Performing git pull to ensure latest changes...",
        );

        // Use simple-git for pull operation
        const git = simpleGit(fullPath);
        const pullResult = await git.pull();

        if (pullResult.summary.changes) {
          winccoa.logDebugF(
            "addonHandler",
            `Pull completed: ${pullResult.summary.changes} changes, ${pullResult.summary.insertions} insertions, ${pullResult.summary.deletions} deletions`,
          );
        } else {
          winccoa.logDebugF("addonHandler", "Repository is already up to date");
        }

        winccoa.logDebugF("addonHandler", "Git pull completed successfully!");

        // Check if package.winccoa.json exists and read its content
        return {
          path: fullPath,
          fileContent: this.readWinCCOAPackageJson(fullPath),
        };
      }

      winccoa.logDebugF(
        "addonHandler",
        `Cloning repository from URL: ${cloneUrl}`,
      );
      winccoa.logDebugF("addonHandler", `Target directory: ${fullPath}`);

      // Ensure the parent directory exists
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
        winccoa.logDebugF(
          "addonHandler",
          `Created parent directory: ${parentDir}`,
        );
      }

      // Use simple-git for clone operation from the parent directory
      const git = simpleGit(parentDir);

      // Build clone options
      const cloneOptions: string[] = [];
      if (branch) {
        cloneOptions.push("--branch", branch);
      }

      winccoa.logDebugF(
        "addonHandler",
        `\nCloning ${branch ? `branch '${branch}' from ` : ""}${cloneUrl}...`,
      );

      // Clone the repository
      const cloneResult = await git.clone(cloneUrl, repoName, cloneOptions);

      winccoa.logDebugF(
        "addonHandler",
        `\nSuccessfully cloned repository to: ${fullPath}`,
      );

      // Perform git pull to ensure we have the very latest changes
      winccoa.logDebugF(
        "addonHandler",
        "Performing git pull to ensure latest changes...",
      );
      const repoGit = simpleGit(fullPath);
      const pullResult = await repoGit.pull();

      if (pullResult.summary.changes) {
        winccoa.logDebugF(
          "addonHandler",
          `Pull completed: ${pullResult.summary.changes} changes, ${pullResult.summary.insertions} insertions, ${pullResult.summary.deletions} deletions`,
        );
      } else {
        winccoa.logDebugF("addonHandler", "Repository is already up to date");
      }

      winccoa.logDebugF("addonHandler", "Git pull completed successfully!");

      // Check if package.winccoa.json exists and read its content
      return {
        path: fullPath,
        fileContent: this.readWinCCOAPackageJson(fullPath),
      };
    } catch (error: any) {
      // Provide more specific error messages based on simple-git error types
      if (
        error.message.includes("repository not found") ||
        error.message.includes("could not read from remote repository") ||
        error.message.includes("not found") ||
        error.message.includes("does not exist")
      ) {
        throw new Error(
          `Repository not found at URL: ${cloneUrl}. Please check the URL and your access permissions.`,
        );
      } else if (
        error.message.includes("already exists") ||
        error.message.includes("destination path")
      ) {
        throw new Error(
          `Directory '${targetDirectory || this.extractRepoNameFromUrl(cloneUrl)}' already exists`,
        );
      } else if (
        error.message.includes("Permission denied") ||
        error.message.includes("authentication")
      ) {
        throw new Error(
          `Authentication failed. Please check your credentials for URL: ${cloneUrl}`,
        );
      } else {
        throw new Error(
          `Failed to clone repository from URL: ${error.message}`,
        );
      }
    }
  }

  /**
   * Check if the current WinCC OA version is compatible with the required version
   * @param requiredVersion Version requirement string (e.g., "^3.21.0", ">=3.20.0")
   * @returns True if the current version is compatible
   */
  private isVersionCompatible(requiredVersion: string): boolean {
    try {
      if (!requiredVersion || !this._oaVersion) {
        return true; // If no version specified, assume compatible
      }

      // Remove whitespace and convert to lowercase
      const requirement = requiredVersion.trim();

      // Handle caret notation (^3.21.0 means >=3.21.0)
      if (requirement.startsWith("^")) {
        const baseVersion = requirement.substring(1);
        const currentVersion = this._oaVersion;

        // Parse versions
        const baseParts = baseVersion
          .split(".")
          .map((v) => parseInt(v, 10) || 0);
        const currentParts = currentVersion
          .split(".")
          .map((v) => parseInt(v, 10) || 0);

        // Normalize to same length
        const maxLength = Math.max(baseParts.length, currentParts.length);
        while (baseParts.length < maxLength) baseParts.push(0);
        while (currentParts.length < maxLength) currentParts.push(0);

        // Check if current version is >= base version
        for (let i = 0; i < maxLength; i++) {
          if (currentParts[i] > baseParts[i]) return true;
          if (currentParts[i] < baseParts[i]) return false;
        }

        // If major version differs, not compatible
        if (baseParts[0] !== currentParts[0]) return false;

        return true; // Versions are equal
      }

      // Handle other operators (>=, >, <=, <, =)
      if (requirement.startsWith(">=")) {
        const baseVersion = requirement.substring(2);
        return !this.isVersionHigher(baseVersion, this._oaVersion);
      } else if (requirement.startsWith(">")) {
        const baseVersion = requirement.substring(1);
        return this.isVersionHigher(this._oaVersion, baseVersion);
      } else if (requirement.startsWith("<=")) {
        const baseVersion = requirement.substring(2);
        return !this.isVersionHigher(this._oaVersion, baseVersion);
      } else if (requirement.startsWith("<")) {
        const baseVersion = requirement.substring(1);
        return this.isVersionHigher(baseVersion, this._oaVersion);
      } else if (requirement.startsWith("=")) {
        const baseVersion = requirement.substring(1);
        return baseVersion === this._oaVersion;
      }

      // Default: treat as exact match requirement
      return requirement === this._oaVersion;
    } catch (error) {
      winccoa.logWarning(`Error checking version compatibility: ${error}`);
      return true; // If error, assume compatible to be safe
    }
  }

  /**
   * Compare two version strings to determine if the first is higher than the second
   * @param version1 First version string (e.g., "1.2.0")
   * @param version2 Second version string (e.g., "1.1.0")
   * @returns True if version1 is higher than version2
   */
  private isVersionHigher(version1: string, version2: string): boolean {
    try {
      // Remove 'v' prefix if present
      const v1 = version1.replace(/^v/, "");
      const v2 = version2.replace(/^v/, "");

      // Split versions into parts and convert to numbers
      const parts1 = v1
        .split(".")
        .map((part) => parseInt(part.replace(/\D/g, ""), 10) || 0);
      const parts2 = v2
        .split(".")
        .map((part) => parseInt(part.replace(/\D/g, ""), 10) || 0);

      // Normalize lengths by padding with zeros
      const maxLength = Math.max(parts1.length, parts2.length);
      while (parts1.length < maxLength) parts1.push(0);
      while (parts2.length < maxLength) parts2.push(0);

      // Compare each part
      for (let i = 0; i < maxLength; i++) {
        if (parts1[i] > parts2[i]) return true;
        if (parts1[i] < parts2[i]) return false;
      }

      return false; // Versions are equal
    } catch (error) {
      winccoa.logWarning(
        `Error comparing versions ${version1} and ${version2}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Map package.winccoa.json content to AddonConfig interface
   * @param packageJson Parsed package.winccoa.json content
   * @returns AddonConfig object
   */
  mapPackageJsonToAddonConfig(packageJson: any): AddonConfig {
    return {
      RepoName: packageJson.RepoName,
      Keywords: packageJson.Keywords || [],
      Version: packageJson.Version,
      Description: packageJson.Description,
      OaVersion: packageJson.OaVersion,
      Subprojects: (packageJson.Subprojects || []).map((sp: any) => ({
        Name: sp.Name,
        Description: sp.Description,
        Managers: sp.Managers
          ? sp.Managers.map((manager: any) => ({
              Name: manager.Name || "",
              StartMode: manager.StartMode || "Unknown",
              Options: manager.Options || "",
              RestartOnUpdate:
                manager.RestartOnUpdate != null
                  ? manager.RestartOnUpdate
                  : true,
            }))
          : [],
        Dplists: sp.Dplists || [],
        UpdateScripts: sp.UpdateScripts || [],
        UnInstallScripts: sp.UninstallScripts || [],
      })),
      Dependencies: packageJson.Dependencies || [],
    };
  }

  /**
   * Read and parse the package.winccoa.json file from a repository
   * @param repositoryPath The full path to the repository directory
   * @returns The parsed JSON content as string, or null if file doesn't exist
   */
  private readWinCCOAPackageJson(repositoryPath: string): string | null {
    try {
      const packageWinCCoAPath = path.join(
        repositoryPath,
        "package.winccoa.json",
      );

      if (fs.existsSync(packageWinCCoAPath)) {
        winccoa.logDebugF(
          "addonHandler",
          "package.winccoa.json found - this appears to be a WinCC OA addon",
        );
        const fileContent = fs.readFileSync(packageWinCCoAPath, "utf8");

        const parseResult = JSON.parse(fileContent);
        winccoa.logDebugF(
          "addonHandler",
          "Parsed package.winccoa.json content:",
          parseResult,
        );

        const JSONstring = JSON.stringify(parseResult, null, 2);
        winccoa.logDebugF(
          "addonHandler",
          "Stringified package.winccoa.json content:",
          JSONstring,
        );

        return JSONstring;
      } else {
        winccoa.logDebugF(
          "addonHandler",
          "package.winccoa.json not found - this may not be a WinCC OA addon",
        );
        return null;
      }
    } catch (error: any) {
      winccoa.logWarning(
        `Failed to read or parse package.winccoa.json: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Extract repository name from git URL
   * @param url Git clone URL (HTTPS or SSH)
   * @returns Repository name
   */
  private extractRepoNameFromUrl(url: string): string {
    try {
      // Handle both HTTPS and SSH URLs
      // HTTPS: https://github.com/owner/repo.git
      // SSH: git@github.com:owner/repo.git
      const match = url.match(/\/([^\/]+?)(?:\.git)?$/);
      if (match && match[1]) {
        return match[1];
      }

      // Fallback: use timestamp if we can't extract name
      return `repo-${Date.now()}`;
    } catch (error) {
      return `repo-${Date.now()}`;
    }
  }

  /**
   * Pull latest changes from a git repository
   * @param repositoryDirectory Absolute path to the repository directory
   * @returns Pull result with summary information
   */
  async pullRepository(repositoryPath: string, session: string): Promise<any> {
    try {
      // Verify the directory exists
      if (!fs.existsSync(repositoryPath)) {
        throw new Error(
          `Repository directory does not exist: ${repositoryPath}`,
        );
      }

      // Verify it's a git repository (check for .git directory)
      const gitDir = path.join(repositoryPath, ".git");
      if (!fs.existsSync(gitDir)) {
        throw new Error(`Directory is not a git repository: ${repositoryPath}`);
      }

      // Read version before pull
      let updatedAddonConfigBeforePull;

      try {
        const packageJsonContentBeforePull =
          this.readWinCCOAPackageJson(repositoryPath);
        if (!packageJsonContentBeforePull) {
          throw new Error("package.winccoa.json not found before pull");
        }
        const parsedPackage = JSON.parse(packageJsonContentBeforePull);
        updatedAddonConfigBeforePull =
          this.mapPackageJsonToAddonConfig(parsedPackage);
      } catch (error) {
        winccoa.logWarning(
          "Could not read package.winccoa.json before pull:",
          error,
        );
        return;
      }

      winccoa.logDebugF(
        "addonHandler",
        `Pulling latest changes from repository: ${repositoryPath}`,
      );

      // Use simple-git for pull operation
      const git = simpleGit(repositoryPath);
      const pullResult = await git.pull();

      if (pullResult.summary.changes) {
        winccoa.logDebugF(
          "addonHandler",
          `Pull completed: ${pullResult.summary.changes} changes, ${pullResult.summary.insertions} insertions, ${pullResult.summary.deletions} deletions`,
        );
      } else {
        winccoa.logDebugF("addonHandler", "Repository is already up to date");
      }

      winccoa.logDebugF("addonHandler", "Git pull completed successfully!");

      // Read version after pull and compare
      // TEMP: hardcoded for testing
      let updatedAddonConfig: AddonConfig | null = null;

      // Read and parse the updated package.winccoa.json as AddonConfig
      const packageJsonContent = this.readWinCCOAPackageJson(repositoryPath);
      if (packageJsonContent) {
        try {
          const parsedPackage = JSON.parse(packageJsonContent);
          updatedAddonConfig = this.mapPackageJsonToAddonConfig(parsedPackage);

          if (
            updatedAddonConfigBeforePull.Version &&
            updatedAddonConfig.Version &&
            this.isVersionHigher(
              updatedAddonConfig.Version,
              updatedAddonConfigBeforePull.Version,
            )
          ) {
            winccoa.logDebugF(
              "addonHandler",
              `INFO: Version updated from ${updatedAddonConfigBeforePull.Version} to ${updatedAddonConfig.Version}`,
            );

            // Check if dependencies changed and process them
            const oldDeps = new Set(
              updatedAddonConfigBeforePull.Dependencies || [],
            );
            const newDeps = new Set(updatedAddonConfig.Dependencies || []);

            const depsChanged =
              oldDeps.size !== newDeps.size ||
              ![...newDeps].every((dep) => oldDeps.has(dep));

            if (
              depsChanged ||
              (updatedAddonConfig.Dependencies &&
                updatedAddonConfig.Dependencies.length > 0)
            ) {
              winccoa.logDebugF(
                "addonHandler",
                `Processing ${updatedAddonConfig.Dependencies?.length || 0} dependencies...`,
              );

              try {
                await this.processDependencies(
                  updatedAddonConfig.Dependencies || [],
                  session,
                  undefined, // processedDeps - fresh start
                  undefined, // currentRepoUrl - not needed for pull
                  true, // registerSubprojects - full installation
                );
                winccoa.logDebugF(
                  "addonHandler",
                  "Dependencies processed successfully",
                );
              } catch (error) {
                winccoa.logWarning(
                  `Failed to process dependencies during pull: ${error}`,
                );
                winccoa.logWarning(
                  "Continuing with repository update despite dependency errors",
                );
                // Continue with the rest of the update process
              }
            } else {
              winccoa.logDebugF(
                "addonHandler",
                "No dependency changes detected",
              );
            }

            // Process each subproject
            for (const subproject of updatedAddonConfig.Subprojects) {
              const subprojectBeforePull =
                updatedAddonConfigBeforePull.Subprojects.find(
                  (sp) => sp.Name === subproject.Name,
                );
              // Import dplist files if available
              if (subproject.Dplists && subproject.Dplists.length > 0) {
                await this.importAsciiFiles(
                  subproject.Dplists,
                  path.join(repositoryPath, subproject.Name, "dplist"),
                );
              }

              // Execute update scripts if any
              if (
                subproject.UpdateScripts &&
                subproject.UpdateScripts.length > 0
              ) {
                winccoa.logDebugF(
                  "addonHandler",
                  `Executing ${subproject.UpdateScripts.length} update script(s) for subproject ${subproject.Name}...`,
                );

                // Create a timeout promise that rejects after 5 minutes
                const timeoutPromise = new Promise<void>((_, reject) => {
                  setTimeout(
                    () => {
                      reject(
                        new Error(
                          "Update scripts execution timed out after 5 minutes",
                        ),
                      );
                    },
                    5 * 60 * 1000,
                  ); // 5 minutes in milliseconds
                });

                // Race the execution against the timeout
                try {
                  // eslint-disable-next-line no-await-in-loop
                  await Promise.race([
                    this.executeScripts(
                      path.join(repositoryPath, subproject.Name),
                      subproject.UpdateScripts,
                    ),
                    timeoutPromise,
                  ]);
                  winccoa.logInfo(
                    `Update scripts for ${subproject.Name} completed successfully`,
                  );
                } catch (error) {
                  if (
                    error instanceof Error &&
                    error.message.includes("timed out")
                  ) {
                    winccoa.logWarning(
                      `Update scripts execution for ${subproject.Name} timed out after 5 minutes`,
                    );
                  } else {
                    winccoa.logWarning(
                      `Error executing update scripts for ${subproject.Name}:`,
                      error,
                    );
                  }
                  throw error;
                }
              } else {
                winccoa.logDebugF(
                  "addonHandler",
                  `No update scripts to execute for subproject ${subproject.Name}`,
                );
              }

              // update node managers
              await NodeInstaller.installAndBuild(repositoryPath);

              if (subprojectBeforePull?.Managers) {
                // Remove managers that are no longer in the updated configuration
                for (const oldManager of subprojectBeforePull.Managers) {
                  const stillExists = subproject.Managers?.find(
                    (newManager) =>
                      newManager.Name === oldManager.Name &&
                      newManager.Options === oldManager.Options,
                  );

                  if (!stillExists) {
                    winccoa.logDebugF(
                      "addonHandler",
                      `Manager ${oldManager.Name} with options "${oldManager.Options}" no longer exists in updated config - removing it`,
                    );
                    // eslint-disable-next-line no-await-in-loop
                    const managerIdx = await this.ctrlScript.start(
                      "managerExists",
                      [oldManager.Name, oldManager.Options],
                      [WinccoaCtrlType.string, WinccoaCtrlType.string],
                    );

                    if (managerIdx !== -1) {
                      // eslint-disable-next-line no-await-in-loop
                      await this.ctrlScript.start(
                        "removeManager",
                        [managerIdx],
                        [WinccoaCtrlType.int],
                      );
                    }
                  }
                }
              }

              if (subproject.Managers) {
                const sessionCredentials = this.pmonCredentials.find(
                  (cred) => cred.session === session,
                );
                const pmonUser = sessionCredentials?.user || "";
                const pmonPassword = sessionCredentials?.password || "";

                for (const manager of subproject.Managers) {
                  // eslint-disable-next-line no-await-in-loop
                  const managerIdx = await this.ctrlScript.start(
                    "managerExists",
                    [manager.Name, manager.Options],
                    [WinccoaCtrlType.string, WinccoaCtrlType.string],
                  );

                  if (managerIdx !== -1 && manager.RestartOnUpdate) {
                    // eslint-disable-next-line no-await-in-loop
                    await this.ctrlScript.start(
                      "restartManager",
                      [managerIdx],
                      [WinccoaCtrlType.int],
                    );
                  } else {
                    // add manager if it does not exist
                    // eslint-disable-next-line no-await-in-loop
                    await this.ctrlScript.start(
                      "addManager",
                      [
                        manager.Name,
                        manager.StartMode.toLowerCase(),
                        manager.Options,
                        pmonUser,
                        pmonPassword,
                      ],
                      [
                        WinccoaCtrlType.string,
                        WinccoaCtrlType.string,
                        WinccoaCtrlType.string,
                        WinccoaCtrlType.string,
                        WinccoaCtrlType.string,
                      ],
                    );
                  }
                }
              }
            }
          }
        } catch (error) {
          winccoa.logWarning(
            `Failed to parse updated package.winccoa.json as AddonConfig:`,
            error,
          );
        }
      }

      return {
        success: true,
        message: "Repository updated successfully",
        directory: repositoryPath,
        changes: pullResult.summary.changes || 0,
        insertions: pullResult.summary.insertions || 0,
        deletions: pullResult.summary.deletions || 0,
        files: pullResult.files || [],
        updatedAt: new Date().toISOString(),
        fileContent: this.readWinCCOAPackageJson(repositoryPath),
        updatedAddonConfig: updatedAddonConfig,
      };
    } catch (error: any) {
      winccoa.logWarning(
        `Failed to pull repository at ${repositoryPath}:`,
        error.message,
      );

      // Provide more specific error messages
      if (error.message.includes("not a git repository")) {
        throw new Error(`Directory is not a git repository: ${repositoryPath}`);
      } else if (error.message.includes("does not exist")) {
        throw new Error(
          `Repository directory does not exist: ${repositoryPath}`,
        );
      } else if (
        error.message.includes("Permission denied") ||
        error.message.includes("authentication")
      ) {
        throw new Error(
          `Authentication failed for repository at: ${repositoryPath}`,
        );
      } else if (error.message.includes("merge conflict")) {
        throw new Error(
          `Merge conflicts detected in repository at: ${repositoryPath}. Please resolve conflicts manually.`,
        );
      } else {
        throw new Error(`Failed to pull repository: ${error.message}`);
      }
    }
  }

  /**
   * List all repositories for a GitHub organization
   * @param org The organization name (e.g., 'winccoa' -> https://github.com/winccoa)
   * @param options Optional parameters for filtering and pagination
   * @returns Array of repository information
   */
  async listOrganizationRepositories(
    org: string,
    options: {
      type?: "all" | "public" | "private" | "forks" | "sources" | "member";
      sort?: "created" | "updated" | "pushed" | "full_name";
      direction?: "asc" | "desc";
      perPage?: number;
      maxPages?: number;
    } = {},
  ): Promise<any[]> {
    const {
      type = "all",
      sort = "updated",
      direction = "desc",
      perPage = 100,
      maxPages = 10,
    } = options;

    try {
      winccoa.logDebugF(
        "addonHandler",
        `Fetching repositories for organization: ${org}`,
      );

      const allRepos: any[] = [];
      let page = 1;
      let hasMorePages = true;

      while (hasMorePages && page <= maxPages) {
        winccoa.logDebugF("addonHandler", `Fetching page ${page}...`);

        // eslint-disable-next-line no-await-in-loop
        const response = await this.octokit.rest.repos.listForOrg({
          org,
          type,
          sort,
          direction,
          per_page: perPage,
          page,
        });

        const repos = response.data.map((repo: any) => ({
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          language: repo.language,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          size: repo.size,
          defaultBranch: repo.default_branch,
          createdAt: repo.created_at,
          updatedAt: repo.updated_at,
          pushedAt: repo.pushed_at,
          cloneUrl: repo.clone_url,
          sshUrl: repo.ssh_url,
          homepage: repo.homepage,
          topics: repo.topics,
          private: repo.private,
          archived: repo.archived,
          disabled: repo.disabled,
          fork: repo.fork,
          hasIssues: repo.has_issues,
          hasProjects: repo.has_projects,
          hasWiki: repo.has_wiki,
          hasPages: repo.has_pages,
          hasDownloads: repo.has_downloads,
          license: repo.license?.name || null,
        }));

        // Fetch package.winccoa.json content for each repository and filter valid WinCC OA addons
        const validRepos: any[] = [];
        for (const repo of repos) {
          try {
            winccoa.logDebugF(
              "addonHandler",
              `Fetching package.winccoa.json for ${repo.fullName}...`,
            );
            const packageResponse = await this.octokit.rest.repos.getContent({
              owner: org,
              repo: repo.name,
              path: "package.winccoa.json",
              ref: repo.defaultBranch,
            });

            // Check if the response is a file (not a directory)
            if (
              "content" in packageResponse.data &&
              packageResponse.data.type === "file"
            ) {
              // Decode base64 content
              const content = Buffer.from(
                packageResponse.data.content,
                "base64",
              ).toString("utf-8");
              try {
                const packageJson = JSON.parse(content);

                // Check version compatibility if OaVersion is specified
                let isCompatible = true;
                if (packageJson.OaVersion && this._oaVersion) {
                  isCompatible = this.isVersionCompatible(
                    packageJson.OaVersion,
                  );

                  if (!isCompatible) {
                    winccoa.logWarning(
                      `Skipping repository ${repo.fullName}: requires OaVersion ${packageJson.OaVersion}, current version is ${this._oaVersion}`,
                    );
                  }
                }

                // Only add to valid repos if compatible
                if (isCompatible) {
                  (repo as any).winccoaPackage = packageJson;
                  validRepos.push(repo); // Only add repos with valid and compatible package.winccoa.json
                  winccoa.logDebugF(
                    "addonHandler",
                    `Found package.winccoa.json for ${repo.fullName} - added to results`,
                  );
                }
              } catch (parseError) {
                winccoa.logWarning(
                  `Invalid JSON in package.winccoa.json for ${repo.fullName}:`,
                  parseError,
                );
                // Don't add repos with invalid JSON to results
              }
            }
          } catch (error: any) {
            // surpress errors as a repo does not have to contain the package.winccoa.json
          }
        }

        allRepos.push(...validRepos);

        // Check if there are more pages
        hasMorePages = response.data.length === perPage;
        page++;
      }

      winccoa.logDebugF(
        "addonHandler",
        `Retrieved ${allRepos.length} WinCC OA addon repositories from organization: ${org}`,
      );
      return allRepos;
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(`Organization '${org}' not found or is not accessible`);
      } else if (error.status === 403) {
        throw new Error(
          `Access denied to organization '${org}'. You may need authentication or proper permissions.`,
        );
      } else {
        throw new Error(
          `Failed to list organization repositories: ${error.message}`,
        );
      }
    }
  }

  listCustomRepositories(): { repositories: object[]; authMethods: string[] } {
    // Read extensions.config.json and return repository info and auth methods
    try {
      const configPath = path.resolve(
        __dirname,
        "../../../config/extensions.config.json",
      );
      if (!fs.existsSync(configPath)) {
        winccoa.logWarning(
          `[listCustomRepositories] extensions.config.json not found at ${configPath}`,
        );
        return { repositories: [], authMethods: [] };
      }
      const fileContent = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(fileContent);

      // Handle new structure with customRepos array and authMethods
      const repositories = (config.customRepos || [])
        .filter((repo: any) => !!repo.url)
        .map((repo: any) => ({
          cloneUrl: repo.url,
          name: repo.name,
        }));

      const authMethods = config.authMethods || [];

      return {
        repositories,
        authMethods,
      };
    } catch (error) {
      winccoa.logWarning(
        "[listCustomRepositories] Failed to read extensions.config.json:",
        error,
      );
      return { repositories: [], authMethods: [] };
    }
  }

  /**
   * Get supported authentication methods from extensions.config.json
   * @returns Array of supported authentication methods
   */
  getSupportedAuthMethods(): string[] {
    try {
      const configPath = path.resolve(
        __dirname,
        "../../../config/extensions.config.json",
      );
      if (!fs.existsSync(configPath)) {
        console.warn(
          `[getSupportedAuthMethods] extensions.config.json not found at ${configPath}`,
        );
        return [];
      }
      const fileContent = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(fileContent);

      return config.authMethods || [];
    } catch (error) {
      winccoa.logWarning(
        "[getSupportedAuthMethods] Failed to read extensions.config.json:",
        error,
      );
      return [];
    }
  }

  public async importAsciiFiles(
    fileList: string | string[],
    dplPath: string,
  ): Promise<void> {
    // Convert single file to array for uniform processing
    const files = Array.isArray(fileList) ? fileList : [fileList];

    for (const file of files) {
      try {
        // eslint-disable-next-line no-await-in-loop
        if (
          !(await AsciiManager.import(winccoa, file, path.join(dplPath, file)))
        ) {
          winccoa.logWarning(`[importAsciiFiles] Failed to import: ${file}`);
        }
      } catch (error) {
        winccoa.logWarning(
          `[importAsciiFiles] Exception while importing ${file}:`,
          error,
        );
      }
    }
  }

  /**
   * Execute a JavaScript file using WinCC OA bootstrap
   * @param scriptFile The JavaScript file to execute
   * @param scriptType The type of script (for logging purposes)
   */
  private async startWinCCOAnodeManager(scriptFile: string): Promise<void> {
    winccoa.logDebugF("addonHandler", `Executing script: ${scriptFile}`);

    const installDir = getWinCCOAInstallDir(winccoa);
    if (installDir) {
      const bootstrapPath = path.join(
        installDir,
        "javascript",
        "winccoa-manager",
        "lib",
        "bootstrap.js",
      );
      const command = `node.exe -- "${bootstrapPath}" -currentproj ${scriptFile}`;
      winccoa.logDebugF(
        "addonHandler",
        `Executing JavaScript command: ${command}`,
      );

      const result = await CommandExecutor.execute(command);
      if (result.exitCode === 0) {
        winccoa.logDebugF(
          "addonHandler",
          `Successfully executed script: ${scriptFile}`,
        );
      } else {
        winccoa.logWarning(
          `Failed to execute script ${scriptFile}. Exit code: ${result.exitCode}, Error: ${result.stderr}`,
        );
      }
    } else {
      winccoa.logWarning(
        `Could not determine WinCC OA installation directory for script: ${scriptFile}`,
      );
    }
  }

  /**
   * Execute scripts based on their file extensions
   * @param repositoryPath The path to the repository
   * @param scripts Array of script filenames
   * @param scriptType Type of scripts being executed (for logging)
   */
  private async executeScripts(
    repositoryPath: string,
    scripts: string[],
  ): Promise<void> {
    for (const scriptFile of scripts) {
      try {
        const fileExtension = path.extname(scriptFile).toLowerCase();

        switch (fileExtension) {
          case ".ctl":
            // For .ctl files, use WCCOActrl manager
            await this.startManagers(repositoryPath, [
              {
                exeName: "WCCOActrl",
                startParams: scriptFile,
              },
            ]);
            break;

          case ".ts":
            // For .ts files, build TypeScript project and execute the transpiled JS file
            await NodeInstaller.installAndBuild(repositoryPath);

            // Execute the transpiled JavaScript file
            const jsScriptFile = scriptFile.replace(/\.ts$/, ".js");
            await this.startWinCCOAnodeManager(jsScriptFile);
            break;

          case ".js":
            // For .js files, execute with Node.js using WinCC OA bootstrap
            await this.startWinCCOAnodeManager(scriptFile);
            break;

          default:
            winccoa.logWarning(
              `Unknown type '${fileExtension}' for file: ${scriptFile}`,
            );
            break;
        }
      } catch (error) {
        winccoa.logWarning(`Failed to execute ${scriptFile}:`, error);
      }
    }

    winccoa.logDebugF("addonHandler", "All update scripts have been processed");
  }

  public async startManagers(
    subprojectPath: string,
    managers: Manager[],
  ): Promise<void> {
    // Create array to hold all manager start promises
    const startPromises: Promise<void>[] = [];

    for (const manager of managers) {
      // Create a promise for each manager startup
      const startPromise = (async () => {
        try {
          // Add .exe extension on Windows if not already present
          let exeName = manager.exeName;
          if (
            os.platform() === "win32" &&
            !exeName.toLowerCase().endsWith(".exe")
          ) {
            exeName += ".exe";
          }

          // First, try to find the executable in the subproject's /bin directory
          let exePath = path.join(subprojectPath, "bin", exeName);
          let foundInBin = fs.existsSync(exePath);

          if (foundInBin) {
            winccoa.logDebugF(
              "addonHandler",
              `[startManagers] Found executable in subproject bin: ${exePath}`,
            );
          } else {
            winccoa.logWarning(
              `[startManagers] Executable not found in subproject bin: ${exePath}`,
            );

            // Search in WinCC OA installation directory
            const installDir = getWinCCOAInstallDir(winccoa);
            if (installDir) {
              // Check standard WinCC OA bin directory
              const installBinPath = path.join(installDir, "bin", exeName);

              if (fs.existsSync(installBinPath)) {
                exePath = installBinPath;
                winccoa.logDebugF(
                  "addonHandler",
                  `[startManagers] Found executable in WinCC OA installation: ${exePath}`,
                );
              } else {
                winccoa.logWarning(
                  `[startManagers] Executable '${exeName}' not found in subproject bin or WinCC OA installation directory`,
                );
                winccoa.logWarning(`[startManagers] Searched paths:`);
                winccoa.logWarning(
                  `  - ${path.join(subprojectPath, "bin", exeName)}`,
                );
                winccoa.logWarning(`  - ${installBinPath}`);
                return;
              }
            } else {
              winccoa.logWarning(
                `[startManagers] Executable not found: ${path.join(subprojectPath, "bin", exeName)}`,
              );
              winccoa.logWarning(
                `[startManagers] Could not determine WinCC OA installation directory for fallback search`,
              );
              return;
            }
          }

          // Check if project parameters are present, add -currentproj if not
          let startParams = manager.startParams;
          const projectParamRegex = /-(?:proj|PROJ|currentproj|CURRENTPROJ)\b/i;
          if (!projectParamRegex.test(startParams)) {
            startParams = "-currentproj " + startParams.trim();
            winccoa.logDebugF(
              "addonHandler",
              `[startManagers] No project parameter found, adding -currentproj to: ${manager.exeName}`,
            );
          }

          // Build the command string with executable and start parameters
          const command = `"${exePath}" ${startParams}`.trim();

          winccoa.logDebugF(
            "addonHandler",
            `###### [startManagers] Starting manager: ${command}`,
          );

          // Execute the command (this will start the manager and return immediately)
          const result = await CommandExecutor.execute(command);

          if (result.exitCode === 0) {
            winccoa.logDebugF(
              "addonHandler",
              `[startManagers] Successfully started manager ${manager.exeName}`,
            );
          } else {
            winccoa.logWarning(
              `[startManagers] Failed to start manager ${manager.exeName}. Exit code: ${result.exitCode}, Error: ${result.stderr}`,
            );
          }
        } catch (error) {
          winccoa.logWarning(
            `[startManagers] Failed to start manager ${manager.exeName}:`,
            error,
          );
        }
      })();

      startPromises.push(startPromise);
    }

    // Wait for all managers to be started (but not for them to finish running)
    await Promise.all(startPromises);

    winccoa.logDebugF(
      "addonHandler",
      `[startManagers] All ${managers.length} manager(s) have been started`,
    );
  }
}
