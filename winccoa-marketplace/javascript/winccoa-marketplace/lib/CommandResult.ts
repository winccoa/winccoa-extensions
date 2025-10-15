/**
 * @interface CommandResult
 * @brief Represents the result of a command execution.
 *
 * This interface defines the structure for command execution results,
 * including command details, exit codes, and output information.
 */
export interface CommandResult {
  /** The command that was executed */
  command: string;
  
  /** The working directory from which the command was executed */
  workingDirectory: string;
  
  /** The exit code returned by the command */
  exitCode: number;
  
  /** Error message if the command failed */
  message: string;
  
  /** Standard error output from the command */
  stderr: string;
  
  /** Standard output from the command */
  stdout: string;
}