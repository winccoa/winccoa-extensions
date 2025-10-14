import {
  WinccoaCtrlScript,
  WinccoaCtrlType,
  WinccoaManager,
} from "winccoa-manager";

import * as path from "path";

/**
 * @enum ComponentId
 * Represents component identifiers used in the system.
 */
export enum ComponentId {
  ASCII_COMPONENT = 6,
  GETCMLICINFO_COMPONENT = 2019,
}

/**
 * @class PathResolver
 * Provides utility functions to resolve paths for system components and files.
 */
export class PathResolver {
  private constructor() {
    // Prevent instantiation
  }

  /**
   * Resolves the absolute path to a specific WinCC OA component.
   *
   * Executes a WinCC OA control script to determine the binary path for the given component.
   * On Windows, appends ".exe" to the path if not already present.
   * Logs a detailed error message to the console if the operation fails.
   *
   * @param winccoa The WinCC OA manager instance.
   * @param componentId The ID of the component to resolve.
   * @return A promise resolving to the normalized component path as a string, or an empty string if an error occurs.
   */
  public static async getComponentPath(
    winccoa: WinccoaManager,
    componentId: ComponentId,
  ): Promise<string> {
    if (!winccoa) {
      console.error(
        `[PathResolver.getComponentPath] Invalid WinCC OA manager instance provided.`,
      );
      return "";
    }

    try {
      const script = new WinccoaCtrlScript(
        winccoa,
        `string main(int componentId) {
           return WINCCOA_BIN_PATH + getComponentName(componentId);
         }`,
      );

      const pathResult = (await script.start(
        "main",
        [componentId],
        [WinccoaCtrlType.int],
      )) as string;

      const normalizedPath = path.normalize(pathResult);
      if (!normalizedPath) {
        return "";
      }

      // Add .exe only on Windows if not already present
      if (process.platform === "win32" && !normalizedPath.endsWith(".exe")) {
        return `${normalizedPath}.exe`;
      }
      return normalizedPath;
    } catch (err) {
      console.error(
        `[PathResolver.getComponentPath] Failed to resolve component path for componentId=${componentId}:`,
        err,
      );
      return "";
    }
  }

  /**
   * Retrieves the file path for a given file name.
   *
   * Executes a WinCC OA control script to resolve the file path based on the provided file name.
   * Logs a detailed error message to the console if the operation fails.
   *
   * @param winccoa The WinCC OA manager instance.
   * @param fileName The name of the file to resolve.
   * @param useDbdFiles Optional. If true, resolves the file path with the dbdfiles directory instead of the dpl directory.
   * @return A promise resolving to the normalized file path as a string, or an empty string if an error occurs.
   */
  public static async getFilePath(
    winccoa: WinccoaManager,
    fileName: string,
    useDbdFiles: boolean = false,
  ): Promise<string> {
    if (!winccoa) {
      console.error(
        `[PathResolver.getFilePath] Invalid WinCC OA manager instance provided.`,
      );
      return "";
    }

    if (!fileName?.trim()) {
      console.error(
        `[PathResolver.getFilePath] Invalid or empty fileName provided.`,
      );
      return "";
    }

    try {
      let pathResult: string = "";
      if (useDbdFiles) {
        const oaPaths = winccoa.getPaths(); // last entry is always installation path
        pathResult = path.join(
          oaPaths[oaPaths.length - 1],
          "dbdfiles",
          `version_${winccoa.getVersionInfo().winccoa.version}`,
          fileName,
        );
      } else {
        const script = new WinccoaCtrlScript(
          winccoa,
          `string main(string fileName) {
           return getPath(DPLIST_REL_PATH, fileName);
         }`,
        );

        pathResult = (await script.start(
          "main",
          [fileName],
          [WinccoaCtrlType.string],
        )) as string;
      }

      return path.normalize(pathResult);
    } catch (err) {
      console.error(
        `[PathResolver.getFilePath] Failed to resolve file path for fileName="${fileName}":`,
        err,
      );
      return "";
    }
  }

  /**
   * Retrieves the project path from the WinCC OA manager instance.
   * Logs a detailed error message to the console if the operation fails.
   *
   * @param winccoa The WinCC OA manager instance.
   * @return The normalized project path as a string, or an empty string if the path cannot be resolved.
   */
  public static getProjectPath(winccoa: WinccoaManager): string {
    if (!winccoa) {
      console.error(
        `[PathResolver.getProjectPath] Invalid WinCC OA manager instance provided.`,
      );
      return "";
    }

    const paths = winccoa.getPaths();
    if (!Array.isArray(paths) || paths.length < 2) {
      console.error(
        `[PathResolver.getProjectPath] Invalid or incomplete paths array returned from WinCC OA manager.`,
      );
      return "";
    }

    return path.normalize(paths[0]);
  }

  /**
   * Retrieves the installation path from the WinCC OA manager instance.
   * Logs a detailed error message to the console if the operation fails.
   *
   * @param winccoa The WinCC OA manager instance.
   * @return The normalized installation path as a string, or an empty string if the path cannot be resolved.
   */
  public static getInstallationPath(winccoa: WinccoaManager): string {
    if (!winccoa) {
      console.error(
        `[PathResolver.getInstallationPath] Invalid WinCC OA manager instance provided.`,
      );
      return "";
    }

    const paths = winccoa.getPaths();
    if (!Array.isArray(paths) || paths.length < 2) {
      console.error(
        `[PathResolver.getInstallationPath] Invalid or incomplete paths array returned from WinCC OA manager.`,
      );
      return "";
    }

    return path.normalize(paths[paths.length - 1]);
  }
}