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
import { AddonConfig } from "./AddonConfig";

/**
 * Interface for manager configuration
 */
export interface Manager {
  exeName: string;
  startParams: string;
}

// Export the class for use in other modules
export { AddOnHandler };

/**
 * WinCC OA AddOn Handler for managing GitHub repositories
 *
 * SECURE AUTHENTICATION METHODS:
 *
 * 1. Environment Variables (Best for Production & WinCC OA):
 *    - Set: GITHUB_TOKEN=ghp_your_token_here
 *    - const handler = new AddOnHandler(); // Auto-detects token
 *    - Keeps tokens out of source code
 *    - Secure for scripts and CI/CD
 *    - Perfect for WinCC OA integration
 *
 * 2. Token Auth Factory Method (WinCC OA Compatible):
 *    - const handler = await AddOnHandler.createWithTokenAuth();
 *    - Requires GITHUB_TOKEN environment variable to be set
 *    - No interactive input - perfect for WinCC OA context
 *    - Clean error messages if token not found
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
 * Get the target clone directory from repositories.config.json storePath, Windows registry, or fall back to current directory
 * Priority order:
 * 1. storePath from repositories.config.json (if exists and is a valid directory)
 * 2. Windows registry PROJECTDIR key
 * 3. Current working directory
 */
function getDefaultProjDir(): string {
  // First, try to read storePath from repositories.config.json
  try {
    const configPath = path.resolve(
      __dirname,
      "../../../config/repositories.config.json",
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
            `Using storePath from repositories.config.json: ${config.storePath}`,
          );
          return config.storePath;
        } else {
          winccoa.logWarning(
            `storePath from repositories.config.json does not exist or is not a directory: ${config.storePath}`,
          );
        }
      }
    }
  } catch (error) {
    winccoa.logDebugF(
      "addonHandler",
      `Could not read storePath from repositories.config.json: ${(error as Error).message}`,
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
  private pmonUser: string = "";
  private pmonPassword: string = "";

  constructor() {
    // Initialize octokit without authentication first
    this.octokit = new Octokit();
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

      console.log("auth methods", authMethods);

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
            '   - Create .env file with GITHUB_TOKEN="your_token"',
          );
        }
      }
    } catch (error) {
      winccoa.logWarning("Error setting up authentication:", error);
      winccoa.logInfo("addonHandler", "Using public access only");
    }
  }

  /**
   * Create an AddOnHandler instance with token-based authentication
   * Uses GITHUB_TOKEN environment variable for secure authentication
   * @returns Promise<AddOnHandler> with authenticated instance
   */
  static async createWithTokenAuth(): Promise<AddOnHandler> {
    const handler = new AddOnHandler();
    const success = await handler.authenticateWithToken();
    if (!success) {
      throw new Error("Token authentication failed");
    }
    return handler;
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

  setPmonUser(user: string): void {
    this.pmonUser = user;
  }

  setPmonPassword(password: string): void {
    this.pmonPassword = password;
  }

  /**
   * Check if the current authentication is valid
   */
  async validateAuthentication(): Promise<boolean> {
    if (!this.isAuthenticated) {
      return false;
    }

    try {
      await this.octokit.rest.users.getAuthenticated();
      return true;
    } catch (error) {
      winccoa.logWarning(
        "Authentication validation failed:",
        (error as any).message,
      );
      return false;
    }
  }

  /**
   * Read GitHub token from multiple sources in order of preference:
   * 1. Environment variable GITHUB_TOKEN
   * 2. .env file in project root
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

    // Try .env file in project root
    try {
      const envPath = path.join(__dirname, "..", ".env");
      if (fs.existsSync(envPath)) {
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
      const testOctokit = new Octokit({ auth: authToken });

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
  `,
  );

  async registerSubProject(
    repoPath: string,
    projectName: string,
    config: AddonConfig,
  ): Promise<number> {
    const ret = (await this.ctrlScript.start(
      "registerSubProj",
      [repoPath, projectName],
      [WinccoaCtrlType.string, WinccoaCtrlType.string],
    )) as number;

    await NodeInstaller.installAndBuild(path.join(repoPath, projectName));

    // Import dplist files if available
    if (
      config.Dplists &&
      Array.isArray(config.Dplists) &&
      config.Dplists.length > 0
    ) {
      winccoa.logDebugF(
        "addonHandler",
        `Importing ${config.Dplists.length} dplist file(s)...`,
      );
      await this.importAsciiFiles(
        config.Dplists,
        path.join(repoPath, projectName, "dplist"),
      );
    } else {
      winccoa.logDebugF("addonHandler", "No dplist files to import");
    }

    for (const manager of config.Managers || []) {
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
          this.pmonUser,
          this.pmonPassword,
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
    config?: AddonConfig,
  ): Promise<number> {
    // Execute uninstall scripts if available
    if (
      config &&
      config.UnInstallScripts &&
      config.UnInstallScripts.length > 0
    ) {
      console.log(
        `Executing ${config.UnInstallScripts.length} uninstall script(s)...`,
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
            config.UnInstallScripts,
          ),
          timeoutPromise,
        ]);
        console.log("Uninstall scripts completed successfully");
      } catch (error) {
        if (error instanceof Error && error.message.includes("timed out")) {
          winccoa.logWarning(
            "Uninstall scripts execution timed out after 5 minutes",
          );
        } else {
          winccoa.logWarning("Error executing uninstall scripts:", error);
        }
        // Continue with unregistration even if scripts fail
        console.log(
          "Continuing with project unregistration despite script errors",
        );
      }
    } else {
      console.log("No uninstall scripts to execute");
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
   * Get current authenticated user information
   */
  async getAuthenticatedUser(): Promise<any> {
    if (!this.isAuthenticated) {
      throw new Error("Not authenticated. Please provide a valid token.");
    }

    try {
      const response = await this.octokit.rest.users.getAuthenticated();
      return {
        login: response.data.login,
        name: response.data.name,
        email: response.data.email,
        publicRepos: response.data.public_repos,
        privateRepos: response.data.total_private_repos,
      };
    } catch (error: any) {
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  /**
   * Get repository information including clone URL and default branch
   */
  async getRepositoryInfo(owner: string, repo: string): Promise<any> {
    try {
      const response = await this.octokit.rest.repos.get({
        owner,
        repo,
      });

      return {
        name: response.data.name,
        fullName: response.data.full_name,
        description: response.data.description,
        cloneUrl: response.data.clone_url,
        sshUrl: response.data.ssh_url,
        defaultBranch: response.data.default_branch,
        private: response.data.private,
      };
    } catch (error: any) {
      throw new Error(`Failed to get repository info: ${error.message}`);
    }
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
   * Extract version from package.winccoa.json file
   * @param repositoryPath The full path to the repository directory
   * @returns The version string or null if not found
   */
  private extractVersionFromPackageJson(repositoryPath: string): string | null {
    try {
      const packageWinCCoAPath = path.join(
        repositoryPath,
        "package.winccoa.json",
      );

      if (fs.existsSync(packageWinCCoAPath)) {
        const fileContent = fs.readFileSync(packageWinCCoAPath, "utf8");
        const parseResult = JSON.parse(fileContent);
        return parseResult.version || parseResult.Version || null;
      }
      return null;
    } catch (error: any) {
      winccoa.logWarning(
        `Failed to extract version from package.winccoa.json: ${error.message}`,
      );
      return null;
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
      Keywords: packageJson.Keywords,
      Subproject: packageJson.Subproject,
      Version: packageJson.Version,
      Description: packageJson.Description,
      OaVersion: packageJson.OaVersion,
      Managers: packageJson.Managers
        ? packageJson.Managers.map((manager: any) => ({
            Name: manager.Name || "",
            StartMode: manager.StartMode || "Unknown",
            Options: manager.Options || "",
          }))
        : [],
      Dplists: packageJson.Dplists || [],
      UpdateScripts: packageJson.UpdateScripts || [],
      UnInstallScripts: packageJson.UnInstallScripts || [],
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
  async pullRepository(repositoryDirectory: string): Promise<any> {
    try {
      // Verify the directory exists
      if (!fs.existsSync(repositoryDirectory)) {
        throw new Error(
          `Repository directory does not exist: ${repositoryDirectory}`,
        );
      }

      // Verify it's a git repository (check for .git directory)
      const gitDir = path.join(repositoryDirectory, ".git");
      if (!fs.existsSync(gitDir)) {
        throw new Error(
          `Directory is not a git repository: ${repositoryDirectory}`,
        );
      }

      // Read version before pull
      const versionBeforePull =
        this.extractVersionFromPackageJson(repositoryDirectory);

      winccoa.logDebugF(
        "addonHandler",
        `Pulling latest changes from repository: ${repositoryDirectory}`,
      );

      // Use simple-git for pull operation
      const git = simpleGit(repositoryDirectory);
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
      const versionAfterPull =
        this.extractVersionFromPackageJson(repositoryDirectory);
      // TEMP: hardcoded for testing
      // const versionAfterPull = "2.0.1"
      let updatedAddonConfig: AddonConfig | null = null;

      if (
        versionBeforePull &&
        versionAfterPull &&
        this.isVersionHigher(versionAfterPull, versionBeforePull)
      ) {
        winccoa.logDebugF(
          "addonHandler",
          `INFO: Version updated from ${versionBeforePull} to ${versionAfterPull}`,
        );

        // Read and parse the updated package.winccoa.json as AddonConfig
        const packageJsonContent =
          this.readWinCCOAPackageJson(repositoryDirectory);
        if (packageJsonContent) {
          try {
            const parsedPackage = JSON.parse(packageJsonContent);
            updatedAddonConfig =
              this.mapPackageJsonToAddonConfig(parsedPackage);

            if (updatedAddonConfig.Dplists) {
              this.importAsciiFiles(
                updatedAddonConfig.Dplists,
                path.join(
                  repositoryDirectory,
                  updatedAddonConfig.Subproject,
                  "dplist",
                ),
              );
            }

            // Execute update scripts if any
            if (updatedAddonConfig.UpdateScripts) {
              winccoa.logDebugF(
                "addonHandler",
                `Executing ${updatedAddonConfig.UpdateScripts.length} update script(s)...`,
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
                await Promise.race([
                  this.executeScripts(
                    repositoryDirectory,
                    updatedAddonConfig.UpdateScripts,
                  ),
                  timeoutPromise,
                ]);
                console.log("Update scripts completed successfully");
              } catch (error) {
                if (
                  error instanceof Error &&
                  error.message.includes("timed out")
                ) {
                  winccoa.logWarning(
                    "Update scripts execution timed out after 5 minutes",
                  );
                } else {
                  winccoa.logWarning("Error executing update scripts:", error);
                }
                throw error;
              }
            } else {
              winccoa.logDebugF("addonHandler", "No update scripts to execute");
            }
          } catch (error) {
            winccoa.logWarning(
              `Failed to parse updated package.winccoa.json as AddonConfig:`,
              error,
            );
          }
        }
      }

      return {
        success: true,
        message: "Repository updated successfully",
        directory: repositoryDirectory,
        changes: pullResult.summary.changes || 0,
        insertions: pullResult.summary.insertions || 0,
        deletions: pullResult.summary.deletions || 0,
        files: pullResult.files || [],
        updatedAt: new Date().toISOString(),
        fileContent: this.readWinCCOAPackageJson(repositoryDirectory),
        updatedAddonConfig: updatedAddonConfig,
      };
    } catch (error: any) {
      winccoa.logWarning(
        `Failed to pull repository at ${repositoryDirectory}:`,
        error.message,
      );

      // Provide more specific error messages
      if (error.message.includes("not a git repository")) {
        throw new Error(
          `Directory is not a git repository: ${repositoryDirectory}`,
        );
      } else if (error.message.includes("does not exist")) {
        throw new Error(
          `Repository directory does not exist: ${repositoryDirectory}`,
        );
      } else if (
        error.message.includes("Permission denied") ||
        error.message.includes("authentication")
      ) {
        throw new Error(
          `Authentication failed for repository at: ${repositoryDirectory}`,
        );
      } else if (error.message.includes("merge conflict")) {
        throw new Error(
          `Merge conflicts detected in repository at: ${repositoryDirectory}. Please resolve conflicts manually.`,
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
            // File doesn't exist or other error - this is expected for many repos
            if (error.status === 404) {
              winccoa.logWarning(
                `No package.winccoa.json found for ${repo.fullName} - skipping repository`,
              );
            } else {
              winccoa.logWarning(
                `Error fetching package.winccoa.json for ${repo.fullName}:`,
                error.message,
              );
            }
            // Don't add repos without valid package.winccoa.json to results
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
    // Read repositories.config.json and return repository info and auth methods
    try {
      const configPath = path.resolve(
        __dirname,
        "../../../config/repositories.config.json",
      );
      if (!fs.existsSync(configPath)) {
        winccoa.logWarning(
          `[listCustomRepositories] repositories.config.json not found at ${configPath}`,
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
        "[listCustomRepositories] Failed to read repositories.config.json:",
        error,
      );
      return { repositories: [], authMethods: [] };
    }
  }

  /**
   * Get supported authentication methods from repositories.config.json
   * @returns Array of supported authentication methods
   */
  getSupportedAuthMethods(): string[] {
    try {
      const configPath = path.resolve(
        __dirname,
        "../../../config/repositories.config.json",
      );
      if (!fs.existsSync(configPath)) {
        console.warn(
          `[getSupportedAuthMethods] repositories.config.json not found at ${configPath}`,
        );
        return [];
      }
      const fileContent = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(fileContent);

      return config.authMethods || [];
    } catch (error) {
      winccoa.logWarning(
        "[getSupportedAuthMethods] Failed to read repositories.config.json:",
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

    // Get current project name from WinCC OA
    const projectName = (await this.ctrlScript.start(
      "getProjectName",
    )) as string;
    winccoa.logDebugF("addonHandler", `Current project name: ${projectName}`);

    const installDir = getWinCCOAInstallDir(winccoa);
    if (installDir) {
      const bootstrapPath = path.join(
        installDir,
        "javascript",
        "winccoa-manager",
        "lib",
        "bootstrap.js",
      );
      const command = `node.exe -- "${bootstrapPath}" -num 99 -pmonIndex 100 -proj ${projectName} ${scriptFile}`;
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
