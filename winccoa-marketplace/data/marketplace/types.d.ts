/**
 * Type definitions for WinCC OA Marketplace
 */

// Interface definitions for IX modals and components
export interface IxModalAction {
    text: string;
    handler?: () => void;
}

export interface IxModalConfig {
    title?: string;
    message: string;
    actions: IxModalAction[];
}

export interface IxModalResult {
    actionIndex: number;
    action: string;
}

export interface IxInputModalConfig {
    title?: string;
    message?: string;
    label?: string;
    placeholder?: string;
    defaultValue?: string;
}

export interface IxUnregisterConfirmResult {
    confirmed: boolean;
    deleteRepository: boolean;
}

// Repository and API types
export interface Repository {
    name: string;
    description?: string;
    private: boolean;
    stars: number;
    forks: number;
    language?: string;
    size?: number;
    createdAt: string;
    updatedAt: string;
    cloneUrl?: string;
    sshUrl?: string;
    cloned?: boolean;
    fileContent?: string; // JSON content from .winccoa-marketplace.json file
    localPath?: string; // Local filesystem path where repository is cloned
    subprojectName?: string; // Subproject name from package.winccoa.json (used for registration)
    loadingAction?: 'download' | 'update' | 'install' | 'uninstall' | 'delete' | null; // Track which action is in progress
    currentVersion?: string; // Currently installed version (from local repo)
    latestVersion?: string; // Latest version from GitHub
    hasUpdate?: boolean; // Whether an update is available
    keywords?: string[]; // Keywords/tags from winccoaPackage
}

export interface ApiError extends Error {
    isSSLError?: boolean;
    isConnectionError?: boolean;
}

// Utility types
export type Theme = 'light' | 'dark';
export type ToastType = 'info' | 'success' | 'error' | 'warning';

// Global window extensions
declare global {
    interface Window {
        ixShowMessage?: (config: IxModalConfig) => Promise<IxModalResult>;
        ixShowInput?: (config: IxInputModalConfig) => Promise<string | null>;
        ixShowUnregisterConfirm?: (repositoryName: string) => Promise<IxUnregisterConfirmResult | null>;
        ixShowDeleteConfirm?: (repositoryName: string) => Promise<boolean>;
        marketplaceUI?: import('./marketplace').MarketplaceUI;
        ixIcons?: any;
    }
}