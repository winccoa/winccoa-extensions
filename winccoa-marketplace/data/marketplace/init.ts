/**
 * Initialize the WinCC OA Marketplace application
 */
import { MarketplaceUI } from './marketplace.js';

// Extend Window interface for global functions
declare global {
    interface Window {
        marketplaceUI?: MarketplaceUI;
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.marketplaceUI = new MarketplaceUI();
});