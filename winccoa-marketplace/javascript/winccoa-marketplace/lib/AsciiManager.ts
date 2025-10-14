import { CommandExecutor } from "./CommandExecutor";
import { ComponentId, PathResolver } from "./PathResolver";
import { File } from "./File";
import { WinccoaManager } from "winccoa-manager";

/**
 * @class AsciiManager
 * @brief Utility class for importing ASCII files using the AsciiManager component.
 *        Provides static methods for preparing and executing ASCII file imports with error and warning handling.
 *
 * Exit codes can be classified as success, warning, or error:
 * - SUCCESS_EXIT_CODES: No log is generated for these codes.
 * - WARNING_EXIT_CODES: A warning is logged.
 * - All others: An error is logged.
 */
export class AsciiManager {
  /** Exit codes considered as successful; no log will be generated for these. */
  private static readonly SUCCESS_EXIT_CODES: number[] = [0];

  /** Exit codes considered as warnings; a warning will be logged for these. */
  private static readonly WARNING_EXIT_CODES: number[] = [55];

  private constructor() {
    // Prevent instantiation
  }

  /**
   * Imports an ASCII file using the AsciiManager component.
   * Logs a clear error message if the import fails, and optionally logs a warning message if the import completes with warnings.
   *
   * @param winccoa The WinCC OA manager instance.
   * @param fileName The name of the ASCII file to import.
   * @param confirm Optional. If true, changes are made without confirmation prompt (-yes). If false (default), no changes are made and no prompt is shown (-no).
   * @param useDbdFiles Optional. If true, looks for file in the dbdfiles directory instead of in the dpl directory.
   * @param logWarnings Optional. If true, warning messages are logged when import completes with warnings. Default is false (warnings are not logged).
   * @param noVerbose Optional. If true, suppresses verbose output from the command execution. Default is false (verbose output is shown).
   * @returns Promise resolving to `true` if import is successful or warning, `false` otherwise.
   */
  public static async import(
    winccoa: WinccoaManager,
    fileName: string,
    confirm: boolean = false,
    useDbdFiles: boolean = false,
    logWarnings: boolean = false,
    noVerbose: boolean = false,
  ): Promise<boolean> {
    try {
      const command = await this.prepareImportCommand(
        winccoa,
        fileName,
        confirm,
        useDbdFiles,
        noVerbose,
      );
      if (!command?.trim()) {
        console.error(
          `[AsciiManager.import] Invalid import command generated for file: "${fileName}".`,
        );
        return false;
      }

      const result = await CommandExecutor.execute(command);
      const exitCode = Number(result.exitCode);

      if (AsciiManager.SUCCESS_EXIT_CODES.includes(exitCode)) {
        // No log for success exit codes
        return true;
      }

      const logDetails = `Command:           ${result.command}
Exit Code:         ${result.exitCode}
Working Directory: ${result.workingDirectory}
Message:           ${result.message || "None"}
Stderr:            ${result.stderr || "None"}
Stdout:            ${result.stdout || "None"}`;

      // Return true for warning exit codes; log only if enabled
      if (AsciiManager.WARNING_EXIT_CODES.includes(exitCode)) {
        if (logWarnings) {
          console.warn(
            `[AsciiManager.import] Import completed with warnings.\n${logDetails}`,
          );
        }
        return true;
      }

      // Only log errors for non-warning, non-success exit codes
      console.error(`[AsciiManager.import] Import failed.\n${logDetails}`);
      return false;
    } catch (err) {
      console.error(
        `[AsciiManager.import] Exception during import of "${fileName}":`,
        err,
      );
      return false;
    }
  }

  /**
   * Extracts the project name from the WinCC OA manager's project path.
   * Handles both Windows-style and Unix-style path separators.
   * Logs a detailed error message to the console if extraction fails.
   *
   * @param winccoa The WinCC OA manager instance.
   * @return The project name as a string, or an empty string if invalid.
   */
  private static getProjectName(winccoa: WinccoaManager): string {
    try {
      const projectPath = PathResolver.getProjectPath(winccoa);
      return (
        projectPath
          ?.trim()
          .replace(/\\/g, "/")
          .split("/")
          .filter(Boolean)
          .pop() ?? ""
      );
    } catch (err) {
      console.error(
        `[AsciiManager.getProjectName] Failed to extract project name:`,
        err,
      );
      return "";
    }
  }

  /**
   * Prepares the command for importing an ASCII file.
   * Retrieves and validates all required paths and project name.
   * Logs a detailed error message to the console if preparation fails.
   *
   * @param winccoa The WinCC OA manager instance.
   * @param fileName The name of the file to import.
   * @param confirm Optional. If true, use "-yes" to change types without confirmation. If false, use "-no" to not change types and not ask.
   * @param useDbdFiles Optional. If true, looks for file in the dbdfiles directory instead of in the dpl directory.
   * @param noVerbose Optional. If true, suppresses verbose output from the command execution. Default is false (verbose output is shown).
   * @return The prepared command string or an empty string if invalid.
   */
  private static async prepareImportCommand(
    winccoa: WinccoaManager,
    fileName: string,
    confirm: boolean = false,
    useDbdFiles: boolean = false,
    noVerbose: boolean = false,
  ): Promise<string> {
    try {
      if (!winccoa) {
        console.error(
          `[AsciiManager.prepareImportCommand] Invalid WinCC OA manager instance.`,
        );
        return "";
      }
      if (!fileName?.trim()) {
        console.error(
          `[AsciiManager.prepareImportCommand] Invalid or empty fileName provided.`,
        );
        return "";
      }

      // Retrieve and trim all required values
      const [asciiManagerPath, importFilePath, runningProjectName] = (
        await Promise.all([
          PathResolver.getComponentPath(winccoa, ComponentId.ASCII_COMPONENT),
          PathResolver.getFilePath(winccoa, fileName, useDbdFiles),
          this.getProjectName(winccoa),
        ])
      ).map((path) => path?.trim());

      if (!asciiManagerPath || !importFilePath || !runningProjectName) {
        console.error(
          `[AsciiManager.prepareImportCommand] Invalid paths: asciiManagerPath="${asciiManagerPath}", importFilePath="${importFilePath}", runningProjectName="${runningProjectName}".`,
        );
        return "";
      }

      if (!(await File.exists(importFilePath))) {
        console.error(
          `[AsciiManager.prepareImportCommand] Import file does not exist: "${importFilePath}".`,
        );
        return "";
      }

      const confirmationFlag = confirm ? "-yes" : "-no";
      const verboseFlag = noVerbose ? "-noVerbose" : "";
      const args = [
        `"${asciiManagerPath}"`,
        "-in",
        `"${importFilePath}"`,
        verboseFlag,
        "-PROJ",
        `"${runningProjectName}"`,
        confirmationFlag,
      ];
      return args.filter(Boolean).join(" ");
    } catch (err) {
      console.error(
        `[AsciiManager.prepareImportCommand] Exception while preparing import command:`,
        err,
      );
      return "";
    }
  }
}