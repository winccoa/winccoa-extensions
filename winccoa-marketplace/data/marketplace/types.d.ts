/**
 * Type definitions for WinCC OA Marketplace
 */

// Interface definitions for IX modals and components
export interface IxModalAction {
    text: string;
    handler?: () => void;
}

export interface IxModalConfig {
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
}

export interface ApiError extends Error {
    isCORSError?: boolean;
    isSSLError?: boolean;
    isConnectionError?: boolean;
}

export interface FetchOptions extends RequestInit {
    mode: RequestMode;
    credentials: RequestCredentials;
    headers: Record<string, string>;
}

// Utility types
export type Theme = 'light' | 'dark';
export type ToastType = 'info' | 'success' | 'error' | 'warning';

// Global window extensions
declare global {
    interface Window {
        ixShowMessage?: (config: IxModalConfig) => Promise<IxModalResult>;
        ixShowInput?: (config: IxInputModalConfig) => Promise<string | null>;
        testIxModal?: () => void;
        testIxInputModal?: () => Promise<void>;
        marketplaceUI?: import('./marketplace').MarketplaceUI;
        ixIcons?: any;
    }
}