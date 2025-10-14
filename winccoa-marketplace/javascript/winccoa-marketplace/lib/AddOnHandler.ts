import { Octokit } from "@octokit/rest";
import { execSync } from "child_process";
import { simpleGit } from "simple-git";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { WinccoaCtrlScript, WinccoaCtrlType, WinccoaManager } from "winccoa-manager";

// Export the class for use in other modules
export { AddOnHandler, RepositoryInfo };

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

interface RepositoryInfo {
  owner: string;
  repo: string;
  branch?: string; // Optional branch, defaults to default branch
}

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
function getTargetCloneDirectory(): string {
  try {
    // Only attempt registry reading on Windows
    if (os.platform() === "win32") {
      const registryPath = "HKEY_LOCAL_MACHINE\\SOFTWARE\\ETM\\WinCC_OA\\3.21";

      // Try to read common WinCC OA registry values
      const commonValueNames = [
        "InstallPath",
        "InstallDir",
        "Path",
        "ProjectPath",
        "RootDir",
        "HomeDir",
      ];

      console.log(`Checking Windows registry: ${registryPath}`);

      // First, try specific value names
      for (const valueName of commonValueNames) {
        const registryValue = readWindowsRegistry(registryPath, valueName);
        if (registryValue && fs.existsSync(registryValue)) {
          console.log(
            `Found WinCC OA directory from registry (${valueName}): ${registryValue}`,
          );
          return path.join(registryValue, "marketplace-repos"); // Create a subdirectory for repos
        }
      }

      // If no specific values found, try to parse all values in the key
      const allValues = readWindowsRegistry(registryPath);
      if (allValues) {
        const lines = allValues.split("\n");
        for (const line of lines) {
          if (line.includes("REG_SZ")) {
            const pathMatch = line.match(/REG_SZ\s+(.+)$/);
            if (pathMatch && pathMatch[1]) {
              const extractedPath = pathMatch[1].trim();
              // Check if this looks like a valid directory path
              if (
                extractedPath.includes("\\") &&
                fs.existsSync(extractedPath)
              ) {
                console.log(
                  `Found valid directory from registry: ${extractedPath}`,
                );
                return path.join(extractedPath, "marketplace-repos");
              }
            }
          }
        }
      }

      console.log("No valid WinCC OA directory found in registry");
    } else {
      console.log("Not running on Windows, registry lookup skipped");
    }
  } catch (error) {
    console.log("Failed to read registry:", (error as Error).message);
  }

  // Fallback to current directory
  const currentDir = process.cwd();
  const targetDir = path.join(currentDir, "marketplace-repos");
  console.log(`Using current directory as target: ${targetDir}`);
  return targetDir;
}

// Target directory where repositories will be cloned
// const TARGET_CLONE_DIRECTORY = getTargetCloneDirectory();
const TARGET_CLONE_DIRECTORY = "."; // For testing, use current directory

class AddOnHandler {
  private octokit: Octokit;
  private isAuthenticated: boolean = false;

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

    // Log the target directory being used
    console.log(`Target clone directory: ${TARGET_CLONE_DIRECTORY}`);
  }

  /**
   * Get the current target clone directory
   */
  getTargetDirectory(): string {
    return TARGET_CLONE_DIRECTORY;
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
    void registerSubProj(string path)
    {
      strreplace(path, "\\", "/");
      pathParts = strsplit(path, "/");

      if (dynlen(pathParts)>0)
      {
        projName = pathParts[dynlen(pathParts)];
      }

      for ( i = 1; i <= dynlen(pathParts) - 1; i++ )
        path += pathParts[i] + "/";

      int ret = paRegProj(projName, path, "", 0, false);
      if (ret < 0)
        return ret;

      dyn_string subProjects;
      paGetSubProjs(PROJ, subProjects);
      if (!subProjects.contains(projName))
      {
        subProjects.append(projName);
        paSetSubProjs(PROJ, subProjects);
      }

      return ret;
    }
    
    void unregisterSubProj(string path)
    {
      strreplace(path, "\\", "/");
      pathParts = strsplit(path, "/");

      if (dynlen(pathParts)>0)
      {
        projName = pathParts[dynlen(pathParts)];
      }

      paGetSubProjs(PROJ, subProjects);
      if (!subProjects.contains(projName))
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
  `
);

async registerSubProject(path: string): Promise<number> {
  return await this.ctrlScript.start("registerSubProj", [path], [WinccoaCtrlType.string]) as number;
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
   * Ensure the target clone directory exists
   */
  private ensureTargetDirectory(): void {
    if (!fs.existsSync(TARGET_CLONE_DIRECTORY)) {
      fs.mkdirSync(TARGET_CLONE_DIRECTORY, { recursive: true });
      console.log(
        `Created target directory: ${path.resolve(TARGET_CLONE_DIRECTORY)}`,
      );
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
   * Clone a repository using git clone command with repository info
   */
  async cloneRepository(
    repositoryInfo: RepositoryInfo,
    targetDirectory?: string,
    useSSH: boolean = false,
  ): Promise<void> {
    try {
      // Get repository information
      const repoInfo = await this.getRepositoryInfo(
        repositoryInfo.owner,
        repositoryInfo.repo,
      );

      if (repoInfo.private) {
        console.warn(
          "Warning: This appears to be a private repository. Make sure you have proper access.",
        );
      }

      // Choose clone URL (HTTPS or SSH)
      const cloneUrl = useSSH ? repoInfo.sshUrl : repoInfo.cloneUrl;

      // Ensure target clone directory exists
      this.ensureTargetDirectory();

      // Determine target directory
      const targetDir = targetDirectory || repoInfo.name;
      const fullPath = path.resolve(TARGET_CLONE_DIRECTORY, targetDir);

      // Check if repository already exists locally
      if (fs.existsSync(fullPath)) {
        console.log(`\nRepository already exists at: ${fullPath}`);
        console.log("Skipping clone operation...");
        console.log("\nWaiting 3 seconds before performing git pull...");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Perform git pull to ensure we have the latest changes
        console.log("Performing git pull to ensure latest changes...");
        const pullCommand = "git pull";
        console.log(`Executing: ${pullCommand}`);

        const pullOutput = execSync(pullCommand, {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: fullPath, // Execute git pull inside the existing repository
          encoding: "utf8",
        });

        if (pullOutput) {
          console.log("Pull output:", pullOutput);
        }

        console.log("Git pull completed successfully!");
        return; // Exit the method early since we don't need to clone
      }

      console.log(`Cloning repository: ${repoInfo.fullName}`);
      console.log(
        `Description: ${repoInfo.description || "No description available"}`,
      );
      console.log(`Clone URL: ${cloneUrl}`);
      console.log(`Target directory: ${fullPath}`);
      console.log(`Default branch: ${repoInfo.defaultBranch}`);

      // Build git clone command
      let cloneCommand = `git clone ${cloneUrl}`;

      // Add branch specification if provided
      if (
        repositoryInfo.branch &&
        repositoryInfo.branch !== repoInfo.defaultBranch
      ) {
        cloneCommand += ` -b ${repositoryInfo.branch}`;
      }

      // Add target directory name (not full path)
      cloneCommand += ` "${targetDir}"`;

      console.log(`\nExecuting: ${cloneCommand}`);
      console.log(`Working directory: ${TARGET_CLONE_DIRECTORY}`);

      // Execute git clone from the target clone directory
      const cloneOutput = execSync(cloneCommand, {
        stdio: ["pipe", "pipe", "pipe"], // Use pipes for Windows compatibility
        cwd: TARGET_CLONE_DIRECTORY, // Execute from the target directory so git creates subdirectory
        encoding: "utf8",
      });

      if (cloneOutput) {
        console.log("Clone output:", cloneOutput);
      }

      console.log(`\nSuccessfully cloned repository to: ${fullPath}`);

      // Wait for a few seconds before doing git pull
      console.log("\nWaiting 3 seconds before performing git pull...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Perform git pull to ensure we have the latest changes
      console.log("Performing git pull to ensure latest changes...");
      const pullCommand = "git pull";
      console.log(`Executing: ${pullCommand}`);

      const pullOutput = execSync(pullCommand, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: fullPath, // Execute git pull inside the cloned repository
        encoding: "utf8",
      });

      if (pullOutput) {
        console.log("Pull output:", pullOutput);
      }

      console.log("Git pull completed successfully!");
    } catch (error: any) {
      if (error.message.includes("Repository not found")) {
        throw new Error(
          `Repository ${repositoryInfo.owner}/${repositoryInfo.repo} not found or is private`,
        );
      } else if (error.message.includes("already exists")) {
        throw new Error(
          `Directory ${targetDirectory || repositoryInfo.repo} already exists`,
        );
      } else {
        throw new Error(`Failed to clone repository: ${error.message}`);
      }
    }
  }

  /**
   * Clone a repository using simple-git with complete URL
   * @param cloneUrl Complete git URL (HTTPS or SSH)
   * @param targetDirectory Optional target directory name
   * @param branch Optional branch to clone
   */
  async cloneRepositoryFromUrl(
    cloneUrl: string,
    targetDirectory?: string,
    branch?: string,
  ): Promise<void> {
    try {
      // Ensure target clone directory exists
      this.ensureTargetDirectory();

      // Extract repository name from URL if no target directory provided
      const repoName = targetDirectory || this.extractRepoNameFromUrl(cloneUrl);
      const fullPath = path.resolve(TARGET_CLONE_DIRECTORY, repoName);
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
        return; // Exit the method early since we don't need to clone
      }

      console.log(`Cloning repository from URL: ${cloneUrl}`);
      console.log(`Target directory: ${fullPath}`);

      // Use simple-git for clone operation
      const git = simpleGit(TARGET_CLONE_DIRECTORY);

      // Build clone options
      const cloneOptions: string[] = [];
      if (branch) {
        cloneOptions.push("--branch", branch);
      }

      console.log(
        `\nCloning ${branch ? `branch '${branch}' from ` : ""}${cloneUrl}...`,
      );

      // Clone the repository
      await git.clone(cloneUrl, repoName, cloneOptions);

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
    } catch (error: any) {
      // Provide more specific error messages based on simple-git error types
      if (
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
   * List recent repositories for a user/organization
   */
  async listUserRepositories(
    username: string,
    count: number = 10,
  ): Promise<any[]> {
    try {
      const response = await this.octokit.rest.repos.listForUser({
        username,
        per_page: count,
        sort: "updated",
        direction: "desc",
      });

      return response.data.map((repo: any) => ({
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        language: repo.language,
        stars: repo.stargazers_count,
        updatedAt: repo.updated_at,
        private: repo.private,
      }));
    } catch (error: any) {
      throw new Error(`Failed to list repositories: ${error.message}`);
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

  /**
   * Clone all repositories from a GitHub organization
   * @param org The organization name
   * @param options Options for filtering repositories and clone behavior
   */
  async cloneOrganizationRepositories(
    org: string,
    options: {
      filter?: {
        includePrivate?: boolean;
        includeArchived?: boolean;
        includeForks?: boolean;
        languages?: string[];
        minStars?: number;
        maxSize?: number; // in KB
      };
      cloneOptions?: {
        useSSH?: boolean;
        targetDirectory?: string;
        maxConcurrent?: number;
      };
      repositoryOptions?: {
        type?: "all" | "public" | "private" | "forks" | "sources" | "member";
        sort?: "created" | "updated" | "pushed" | "full_name";
        direction?: "asc" | "desc";
      };
    } = {},
  ): Promise<void> {
    try {
      console.log(`Starting bulk clone for organization: ${org}\n`);

      // Get all repositories
      const repos = await this.listOrganizationRepositories(
        org,
        options.repositoryOptions,
      );

      // Apply filters
      let filteredRepos = repos;
      const filter = options.filter || {};

      if (!filter.includePrivate) {
        filteredRepos = filteredRepos.filter((repo) => !repo.private);
      }

      if (!filter.includeArchived) {
        filteredRepos = filteredRepos.filter((repo) => !repo.archived);
      }

      if (!filter.includeForks) {
        filteredRepos = filteredRepos.filter((repo) => !repo.fork);
      }

      if (filter.languages && filter.languages.length > 0) {
        filteredRepos = filteredRepos.filter(
          (repo) => repo.language && filter.languages!.includes(repo.language),
        );
      }

      if (filter.minStars) {
        filteredRepos = filteredRepos.filter(
          (repo) => repo.stars >= filter.minStars!,
        );
      }

      if (filter.maxSize) {
        filteredRepos = filteredRepos.filter(
          (repo) => repo.size <= filter.maxSize!,
        );
      }

      console.log(
        `Found ${repos.length} total repositories, ${filteredRepos.length} match filters`,
      );

      if (filteredRepos.length === 0) {
        console.log("No repositories match the specified filters.");
        return;
      }

      // Clone repositories
      const cloneOptions = options.cloneOptions || {};
      const maxConcurrent = cloneOptions.maxConcurrent || 1; // Sequential by default to avoid overwhelming

      console.log(
        `\nStarting to clone ${filteredRepos.length} repositories...\n`,
      );

      for (let i = 0; i < filteredRepos.length; i += maxConcurrent) {
        const batch = filteredRepos.slice(i, i + maxConcurrent);

        const clonePromises = batch.map(async (repo) => {
          try {
            console.log(`Cloning ${repo.fullName}...`);
            await this.cloneRepository(
              { owner: org, repo: repo.name },
              cloneOptions.targetDirectory
                ? `${cloneOptions.targetDirectory}/${repo.name}`
                : repo.name,
              cloneOptions.useSSH,
            );
            console.log(`Successfully cloned ${repo.fullName}`);
          } catch (error: any) {
            console.error(`Failed to clone ${repo.fullName}: ${error.message}`);
          }
        });

        await Promise.all(clonePromises);
      }

      console.log(`\nCompleted cloning process for organization: ${org}`);
    } catch (error: any) {
      throw new Error(
        `Failed to clone organization repositories: ${error.message}`,
      );
    }
  }
}

/**
 * Example usage function
 */
async function main() {
  try {
    // Authentication setup - uncomment and add your token for private repos
    // const authToken = process.env.GITHUB_TOKEN || 'your_github_token_here';
    // const cloner = new GitHubCloner(authToken);

    // For public repositories only (no authentication)
    const cloner = new AddOnHandler();

    // Example: Clone WinCC OA repository
    const repositoryToClone: RepositoryInfo = {
      owner: "winccoa",
      repo: "winccoa-ae-ctrl-itotlayer",
      // branch: 'main' // Optional: specify a specific branch
    };

    console.log("=== GitHub Repository Cloner ===\n");

    console.log(
      `Target clone directory: ${path.resolve(TARGET_CLONE_DIRECTORY)}\n`,
    );

    // Validate authentication if provided
    if (await cloner.validateAuthentication()) {
      const user = await cloner.getAuthenticatedUser();
      console.log(
        `Authenticated as: ${user.login} (${user.name || "No name"})`,
      );
      console.log(
        `Access: ${user.publicRepos} public, ${user.privateRepos} private repos\n`,
      );
    }

    // Option 1: Just get repository information
    console.log("Repository Information:");
    const repoInfo = await cloner.getRepositoryInfo(
      repositoryToClone.owner,
      repositoryToClone.repo,
    );
    console.log(`Name: ${repoInfo.fullName}`);
    console.log(`Description: ${repoInfo.description}`);
    console.log(`Default Branch: ${repoInfo.defaultBranch}`);
    console.log(`Clone URL: ${repoInfo.cloneUrl}\n`);
    // Option 2: List user repositories
    console.log("Recent repositories from WinCC OA:");
    const repos = await cloner.listUserRepositories("winccoa", 5);
    repos.forEach((repo, index) => {
      console.log(
        `${index + 1}. ${repo.fullName} (${repo.language || "N/A"}) - ${repo.stars} stars`,
      );
    });

    // Option 3: List ALL repositories from WinCC OA organization
    console.log("\nAll repositories from WinCC OA organization:");
    const orgRepos = await cloner.listOrganizationRepositories("winccoa", {
      type: "public", // Only public repos since we're not authenticated
      sort: "updated",
      direction: "desc",
      perPage: 50,
      maxPages: 5,
    });

    console.log(`\nOrganization Summary:`);
    console.log(`Total repositories found: ${orgRepos.length}`);
    console.log(
      `Languages used: ${[...new Set(orgRepos.map((r) => r.language).filter(Boolean))].join(", ")}`,
    );
    console.log(
      `Total stars: ${orgRepos.reduce((sum, repo) => sum + repo.stars, 0)}`,
    );

    console.log(`\nRepository List:`);
    orgRepos.forEach((repo, index) => {
      const status = repo.archived
        ? "[ARCHIVED]"
        : repo.private
          ? "[PRIVATE]"
          : "[PUBLIC]";
      const fork = repo.fork ? "[FORK]" : "";
      console.log(`${index + 1}. ${status}${fork} ${repo.fullName}`);
      console.log(`    ${repo.description || "No description"}`);
      console.log(
        `    Language: ${repo.language || "N/A"} | Stars: ${repo.stars} | Forks: ${repo.forks} | Size: ${(repo.size / 1024).toFixed(1)}MB`,
      );
      console.log(
        `    Updated: ${new Date(repo.updatedAt).toLocaleDateString()}\n`,
      );
    });

    // Clone the repository using repository info
    console.log("\nCloning repository using repository info...");
    await cloner.cloneRepository(
      repositoryToClone,
      "winccoa-ae-ctrl-itotlayer-clone",
    );

    // Example: Clone repository using complete URL
    console.log("\nCloning repository using complete URL...");
    const exampleUrl =
      "https://github.com/winccoa/winccoa-ae-ctrl-itotlayer.git";
    await cloner.cloneRepositoryFromUrl(
      exampleUrl,
      "winccoa-ae-ctrl-itotlayer-url-clone",
      // "main" // Optional: specify branch
    );

    console.log("\nScript completed successfully!");
    console.log(
      "You can also modify the repositoryToClone object to clone different repositories.",
    );

    // Additional examples (uncomment to use):

    // Example 4: Clone ALL repositories from an organization with filters
    // console.log('\nBulk cloning example (COMMENTED OUT):');
    // await cloner.cloneOrganizationRepositories('winccoa', {
    //   filter: {
    //     includePrivate: false,     // Only public repos
    //     includeArchived: false,    // Skip archived repos
    //     includeForks: false,       // Skip forks
    //     languages: ['TypeScript', 'JavaScript'], // Only specific languages
    //     minStars: 1,              // Minimum star count
    //     maxSize: 10240            // Max 10MB repositories
    //   },
    //   cloneOptions: {
    //     useSSH: false,            // Use HTTPS
    //     targetDirectory: 'winccoa-org-repos', // Custom directory
    //     maxConcurrent: 2          // Clone 2 repos at a time
    //   },
    //   repositoryOptions: {
    //     type: 'public',           // Only public repos
    //     sort: 'updated',          // Sort by last update
    //     direction: 'desc'         // Newest first
    //   }
    // });

    // Example 5: Get specific organization info
    // const specificOrgRepos = await cloner.listOrganizationRepositories('winccoa', {
    //   type: 'sources',  // Only original repos (not forks)
    //   sort: 'stars',    // Sort by popularity
    //   direction: 'desc'
    // });
    // console.log('Most popular winccoa repositories:', specificOrgRepos.slice(0, 3));
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

// Run the example if this script is executed directly (not imported as a module)
if (require.main === module) {
  main().catch(console.error);
}
