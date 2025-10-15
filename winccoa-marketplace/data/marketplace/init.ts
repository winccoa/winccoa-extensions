/**
 * Initialize the WinCC OA Marketplace application
 */
import { MarketplaceUI } from './marketplace.js';

// Extend Window interface for global functions
declare global {
    interface Window {
        closeCloneModal?: () => void;
        confirmClone?: () => void;
        marketplaceUI?: MarketplaceUI;
    }
}

// Global functions for modal actions (kept for compatibility)
window.closeCloneModal = function(): void {
    console.log('🔧 closeCloneModal called');
    const modal = document.getElementById('clone-modal');
    
    if (modal) {
        // IX modal close
        modal.removeAttribute('open');
        
        // Clear input
        const pathInput = document.getElementById('clone-path-input') as HTMLInputElement | null;
        if (pathInput) {
            pathInput.value = '';
        }
        
        console.log('🔧 IX Modal closed');
    }
}

window.confirmClone = function(): void {
    console.log('🔧 confirmClone called');
    if (window.marketplaceUI) {
        window.marketplaceUI.confirmClone();
    } else {
        console.error('❌ marketplaceUI not found on window');
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.marketplaceUI = new MarketplaceUI();
});