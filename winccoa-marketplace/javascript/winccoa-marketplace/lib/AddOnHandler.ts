import { Octokit } from "@octokit/rest";
import { execSync } from "child_process";
import { simpleGit } from "simple-git";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { WinccoaCtrlScript, WinccoaCtrlType, WinccoaManager } from "winccoa-manager";
import { AsciiManager } from "./AsciiManager";
import { NodeInstaller } from "./NodeInstaller";
import { AddonConfig, ManagerConfig } from "./AddonConfig";


// Export the class for use in other modules
export { AddOnHandler };

/**
 * Simple script to clone a public GitHub repository using octokit.js
 *
 * AUTHENTICATION SETUP:
 *
 * 1. Personal Access Token (Recommended):
 *    - Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
 *    - Click "Generate new token"
 *    - Select scopes: "repo" (for private repos) or "public_repo" (for public repos)
 *    - Copy the generated token
 *    - Set environment variable: GITHUB_TOKEN=your_token_here
 *    - Or pass directly to constructor: new GitHubCloner('your_token_here')
 *
 * 2. Environment Variable Setup:
 *    Windows PowerShell: $env:GITHUB_TOKEN="your_token_here"
 *    Windows CMD: set GITHUB_TOKEN=your_token_here
 *    Linux/Mac: export GITHUB_TOKEN=your_token_here
 *
 * 3. Benefits of Authentication:
 *    - Access private repositories
 *    - Higher rate limits (5000 vs 60 requests/hour)
 *    - Access to organization repositories
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
 * Get the target clone directory from Windows registry or fall back to current directory
 * Registry path: HKEY_LOCAL_MACHINE\SOFTWARE\ETM\WinCC_OA\3.21
 */
function getDefaultProjDir(): string {
  try {
    // Only attempt registry reading on Windows
    if (os.platform() === "win32") {
      const registryPath = "HKEY_LOCAL_MACHINE\\SOFTWARE\\ETM\\WinCC_OA\\3.21";

      console.log(`Checking Windows registry: ${registryPath}`);

      // Read only the PROJECTDIR key
      const registryValue = readWindowsRegistry(registryPath, "PROJECTDIR");
      if (registryValue && fs.existsSync(registryValue)) {
        console.log(
          `Found WinCC OA PROJECTDIR from registry: ${registryValue}`,
        );
        return registryValue;
      }

      console.log("No valid WinCC OA PROJECTDIR found in registry");
    } else {
      console.log("Not running on Windows, registry lookup skipped");
    }
  } catch (error) {
    console.log("Failed to read registry:", (error as Error).message);
  }

  // Fallback to current directory
  return process.cwd();
}

class AddOnHandler {
  private octokit: Octokit;
  private isAuthenticated: boolean = false;
  private _defaultDirectory: string;

  constructor(authToken?: string) {
    if (authToken) {
      // Initialize octokit with authentication
      this.octokit = new Octokit({
        auth: authToken,
      });
      this.isAuthenticated = true;
      console.log("GitHub authentication enabled");
    } else {
      // Initialize octokit for public repositories only
      this.octokit = new Octokit();
      console.log("No authentication - limited to public repositories");
    }

    this._defaultDirectory = getDefaultProjDir();
    // Log the target directory being used
    console.log(`Target clone directory: ${this._defaultDirectory}`);
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
      console.error(
        "Authentication validation failed:",
        (error as any).message,
      );
      return false;
    }
  }

  private readonly ctrlScript: WinccoaCtrlScript = new WinccoaCtrlScript(winccoa,
  `
#uses "CtrlPv2Admin"

int registerSubProj(string path)
{
  string projName;
  dyn_string pathParts;

  strreplace(path, "//", "/");
  pathParts = strsplit(path, "/");

  if (dynlen(pathParts) > 0)
  {
    projName = pathParts[dynlen(pathParts)];
  }

  path = "";
  for (int i = 1; i <= dynlen(pathParts) - 1; i++)
    path += pathParts[i] + "/";

  int ret = paRegProj(projName, path, "", 0, true);

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

int unregisterSubProj(string path)
{
  string projName;
  dyn_string subProjects;

  strreplace(path, "//", "/");
  dyn_string pathParts = strsplit(path, "/");

  if (dynlen(pathParts) > 0)
  {
    projName = pathParts[dynlen(pathParts)];
  }

  paGetSubProjs(PROJ, subProjects);

  if (subProjects.contains(projName))
  {
    int idx = subProjects.indexOf(projName, 0);
    subProjects.removeAt(idx);
    paSetSubProjs(PROJ, subProjects);
  }

  return paDelProj(projName, true);
}

dyn_dyn_string listSubProjs()
{
  dyn_string projects, versions, paths;
  dyn_string subProjects;
  paGetProjs(projects, versions, paths);

  return makeDynAnytype(projects, paths);
}

int gTcpFileDescriptor2;
string host;
string port;
bool addManager(string manager, string startMode, string options, string user, string pwd)
{
  paGetProjHostPort(PROJ, host, port);
  gTcpFileDescriptor2 = tcpOpen(host, port);
  ProjEnvProject proj  = new ProjEnvProject(PROJ);
  dyn_anytype managers = proj.getListOfManagersStati();
  bool err;
  
  pmonInsertManager(err, PROJ, dynlen(managers), makeDynString(manager, startMode, 2, 2, 30, options), user, pwd);
  return err;
}
  `
);

async registerSubProject(path: string, config: AddonConfig): Promise<number> {
  const ret = await this.ctrlScript.start("registerSubProj", [path], [WinccoaCtrlType.string]) as number;
  await NodeInstaller.installAndBuild(path);

  for (const manager of config.Managers || []) {
    console.log(`Adding manager ${manager.Name} with start mode ${manager.StartMode} and options ${manager.Options}`);
    // eslint-disable-next-line no-await-in-loop
    await this.ctrlScript.start("addManager", [manager.Name, manager.StartMode, manager.Options, "", ""], 
      [WinccoaCtrlType.string, WinccoaCtrlType.string, WinccoaCtrlType.string, WinccoaCtrlType.string, WinccoaCtrlType.string]);
  }
  return ret;
}

async unregisterSubProject(path: string): Promise<number> {
  return await this.ctrlScript.start("unregisterSubProj", [path], [WinccoaCtrlType.string]) as number;
}

async listSubProjects(): Promise<string[]> {
  return await this.ctrlScript.start("listSubProjs") as string[];
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

      console.log(`Target directory: ${fullPath}`);

      // Check if repository already exists locally
      if (fs.existsSync(fullPath)) {
        console.log(`\nRepository already exists at: ${fullPath}`);
        console.log("Performing git pull to ensure latest changes...");

        // Use simple-git for pull operation
        const git = simpleGit(fullPath);
        const pullResult = await git.pull();

        if (pullResult.summary.changes) {
          console.log(
            `Pull completed: ${pullResult.summary.changes} changes, ${pullResult.summary.insertions} insertions, ${pullResult.summary.deletions} deletions`,
          );
        } else {
          console.log("Repository is already up to date");
        }

        console.log("Git pull completed successfully!");
        
        // Check if package.winccoa.json exists and read its content
        return { path: fullPath, fileContent: this.readWinCCOAPackageJson(fullPath) };
      }

      console.log(`Cloning repository from URL: ${cloneUrl}`);
      console.log(`Target directory: ${fullPath}`);

      // Ensure the parent directory exists
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
        console.log(`Created parent directory: ${parentDir}`);
      }

      // Use simple-git for clone operation from the parent directory
      const git = simpleGit(parentDir);

      // Build clone options
      const cloneOptions: string[] = [];
      if (branch) {
        cloneOptions.push("--branch", branch);
      }

      console.log(
        `\nCloning ${branch ? `branch '${branch}' from ` : ""}${cloneUrl}...`,
      );

      // Clone the repository
      const cloneResult = await git.clone(cloneUrl, repoName, cloneOptions);

      console.log(`\nSuccessfully cloned repository to: ${fullPath}`);

      // Perform git pull to ensure we have the very latest changes
      console.log("Performing git pull to ensure latest changes...");
      const repoGit = simpleGit(fullPath);
      const pullResult = await repoGit.pull();

      if (pullResult.summary.changes) {
        console.log(
          `Pull completed: ${pullResult.summary.changes} changes, ${pullResult.summary.insertions} insertions, ${pullResult.summary.deletions} deletions`,
        );
      } else {
        console.log("Repository is already up to date");
      }

      console.log("Git pull completed successfully!");

      // Check if package.winccoa.json exists and read its content
      return { path: fullPath, fileContent: this.readWinCCOAPackageJson(fullPath) };

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
   * Read and parse the package.winccoa.json file from a repository
   * @param repositoryPath The full path to the repository directory
   * @returns The parsed JSON content as string, or null if file doesn't exist
   */
  private readWinCCOAPackageJson(repositoryPath: string): string | null {
    try {
      const packageWinCCoAPath = path.join(repositoryPath, "package.winccoa.json");
      
      if (fs.existsSync(packageWinCCoAPath)) {
        console.log("package.winccoa.json found - this appears to be a WinCC OA addon");
        const fileContent = fs.readFileSync(packageWinCCoAPath, 'utf8');
        return JSON.stringify(JSON.parse(fileContent), null, 2);
      } else {
        console.log("package.winccoa.json not found - this may not be a WinCC OA addon");
        return null;
      }
    } catch (error: any) {
      console.error(`Failed to read or parse package.winccoa.json: ${error.message}`);
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

      console.log(
        `Pulling latest changes from repository: ${repositoryDirectory} to {}`,
      );

      // Use simple-git for pull operation
      const git = simpleGit(repositoryDirectory);
      const pullResult = await git.pull();

      if (pullResult.summary.changes) {
        console.log(
          `Pull completed: ${pullResult.summary.changes} changes, ${pullResult.summary.insertions} insertions, ${pullResult.summary.deletions} deletions`,
        );
      } else {
        console.log("Repository is already up to date");
      }

      console.log("Git pull completed successfully!");

      return {
        success: true,
        message: "Repository updated successfully",
        directory: repositoryDirectory,
        changes: pullResult.summary.changes || 0,
        insertions: pullResult.summary.insertions || 0,
        deletions: pullResult.summary.deletions || 0,
        files: pullResult.files || [],
        updatedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error(
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
      console.log(`Fetching repositories for organization: ${org}`);

      const allRepos: any[] = [];
      let page = 1;
      let hasMorePages = true;

      while (hasMorePages && page <= maxPages) {
        console.log(`Fetching page ${page}...`);

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

        allRepos.push(...repos);

        // Check if there are more pages
        hasMorePages = response.data.length === perPage;
        page++;
      }

      console.log(
        `Retrieved ${allRepos.length} repositories from organization: ${org}`,
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

  public async importAsciiFiles(fileList: string | string[]): Promise<void> {
    // Convert single file to array for uniform processing
    const files = Array.isArray(fileList) ? fileList : [fileList];
    
    for (const file of files) {
      try {
        if (!(await AsciiManager.import(winccoa, file))) {
          console.error(`[importAsciiFiles] Failed to import: ${file}`);
        }
      } catch (error) {
        console.error(
          `[importAsciiFiles] Exception while importing ${file}:`,
          error,
        );
      }
    }
  }
}
