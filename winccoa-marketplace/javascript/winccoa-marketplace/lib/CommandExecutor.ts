import { CommandResult } from "./CommandResult";
import { exec } from "child_process";

/**
 * @class CommandExecutor
 * @brief Utility class for executing system commands with error handling and logging.
 *
 * This class cannot be instantiated. Use its static methods to execute commands.
 */
export class CommandExecutor {
  /**
   * @brief Private constructor to prevent instantiation.
   */
  private constructor() {
    // Prevent instantiation
  }

  /**
   * @brief Executes a system command from a specified directory.
   *
   * Executes the given system command using the specified working directory (if provided).
   * Captures and returns the command's output, error, exit code, and other details in a CommandResult object.
   *
   * @param command The system command to execute (e.g., "start calc.exe").
   * @param cwd Optional. The directory from which to execute the command. If not specified, the current working directory is used.
   * @return A promise resolving to a CommandResult object containing execution details.
   *
   * @see CommandResult
   */
  // eslint-disable-next-line require-await
  public static async execute(
    command: string,
    cwd?: string,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      exec(command, { cwd }, (err, stdout, stderr) => {
        const result: CommandResult = {
          command,
          workingDirectory: cwd ?? "Not specified (using current directory)",
          exitCode: err?.code !== undefined ? err.code : 0,
          message: err?.message || "",
          stderr: stderr || "",
          stdout: stdout || "",
        };

        resolve(result);
      });
    });
  }
}