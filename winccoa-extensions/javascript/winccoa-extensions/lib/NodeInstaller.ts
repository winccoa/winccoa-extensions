import * as fs from "fs";
import * as path from "path";
import { CommandExecutor } from "./CommandExecutor";
import { WinccoaManager } from "winccoa-manager";

const winccoa = new WinccoaManager();

export class NodeInstaller {
  constructor(private rootDir: string) {}

  // Recursively find all directories containing package.json
  static async findPackageDirs(
    dir: string,
    found: string[] = [],
  ): Promise<string[]> {
    if (!fs.existsSync(dir)) return [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const hasPackageJson = entries.some(
      (e) => e.isFile() && e.name === "package.json",
    );
    if (hasPackageJson) {
      winccoa.logDebugF("addonHandler", `Found package.json in ${dir}`);
      found.push(dir);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "node_modules") {
        await this.findPackageDirs(path.join(dir, entry.name), found);
      }
    }
    return found;
  }

  // Run a shell command in a given directory
  static async runCommand(
    cmd: string,
    args: string[],
    cwd: string,
  ): Promise<void> {
    winccoa.logDebugF(
      "addonHandler",
      `Running command: ${cmd} ${args.join(" ")} in ${cwd}`,
    );
    const result = await CommandExecutor.execute([cmd, ...args].join(" "), cwd);
    if (result.exitCode !== 0) {
      winccoa.logWarning(
        `${cmd} ${args.join(" ")} failed with code ${result.exitCode}\n${result.stderr}`,
      );
    }
  }

  // Install and build all found package.json directories
  static async installAndBuild(projDir: string): Promise<void> {
    const dirs = await this.findPackageDirs(path.join(projDir, "javascript"));
    for (const dir of dirs) {
      winccoa.logDebugF("addonHandler", `Installing and building in ${dir}`);
      await this.runCommand("npm", ["install"], dir);
      await this.runCommand(
        "npm",
        [
          "install",
          "--save-dev",
          '"' +
            winccoa.getPaths()[winccoa.getPaths().length - 1] +
            "javascript/@types/winccoa-manager" +
            '"',
        ],
        dir,
      );
      await this.runCommand("npx", ["tsc"], dir);
    }
  }
}
