import * as fs from "fs";

/**
 * @class File
 * @brief Utility class for file system operations.
 *
 * This class provides static methods for common file operations
 * and cannot be instantiated.
 */
export class File {
  private constructor() {
    // Prevent instantiation
  }

  /**
   * Checks if a file exists at the specified path.
   *
   * @param filePath The path to the file to check.
   * @return A promise resolving to true if the file exists, false otherwise.
   */
  public static async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Synchronously checks if a file exists at the specified path.
   *
   * @param filePath The path to the file to check.
   * @return true if the file exists, false otherwise.
   */
  public static existsSync(filePath: string): boolean {
    try {
      fs.accessSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}