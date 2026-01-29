/**
 * Initialize the WinCC OA Extensions application
 */
import { ExtensionsUI } from "./extensions.js";

// Extend Window interface for global functions
declare global {
  interface Window {
    ExtensionsUI?: ExtensionsUI;
  }
}

// Initialize the application when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.ExtensionsUI = new ExtensionsUI();
});
