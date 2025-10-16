/**
 * WinCC OA Marketplace Web Interface TypeScript
 * Handles API integration and user interactions
 */

import type {
    Repository,
    ApiError,
    IxModalConfig,
    IxModalResult,
    IxInputModalConfig,
    Theme,
    ToastType
} from './types';

// Make this file a module by adding an export
export {};

export class MarketplaceUI {
    private baseUrl: string;
    private currentRepository: Repository | null = null;
    private repositories: Repository[] = [];
    private registeredProjects: string[] = [];
    private currentMode: 'marketplace' | 'registered' = 'marketplace';
    private predefinedOrganizations: string[] = ['winccoa'];
    private currentLoadController: AbortController | null = null; // Track ongoing load requests
    private selectedKeywords: string[] = []; // Track selected keywords for filtering (empty = all)

    constructor() {
        // Auto-detect backend URL based on current frontend URL
        this.baseUrl = window.location.origin;
        
        // Show connection info to user
        this.showConnectionInfo();
        
        this.populateOrganizationSelect();
        this.initializeEventListeners();
        this.loadInitialData();
    }

    /**
     * Populate organization select dropdown with predefined values
     */
    private populateOrganizationSelect(): void {
        const orgSelect = document.getElementById('organization-select') as any;
        if (!orgSelect) return;
        
        // Add "All organizations" option (empty value)
        const allOption = document.createElement('ix-select-item');
        allOption.setAttribute('label', 'All organizations');
        allOption.setAttribute('value', '');
        orgSelect.appendChild(allOption);
        
        // Add predefined organizations
        this.predefinedOrganizations.forEach(org => {
            const option = document.createElement('ix-select-item');
            option.setAttribute('label', org);
            option.setAttribute('value', org);
            orgSelect.appendChild(option);
        });
    }

    /**
     * Initialize theme based on saved preference or system preference
     */
    private initializeTheme(): void {
        const savedTheme = localStorage.getItem('marketplace-theme') as Theme | null;
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        let theme: Theme = 'light';
        if (savedTheme) {
            theme = savedTheme;
        } else if (prefersDark) {
            theme = 'dark';
        }
        
        this.setTheme(theme);
        
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e: MediaQueryListEvent) => {
            if (!localStorage.getItem('marketplace-theme')) {
                this.setTheme(e.matches ? 'dark' : 'light');
            }
        });
    }

    /**
     * Set the theme
     */
    private setTheme(theme: Theme): void {
        const body = document.body;
        const themeToggle = document.getElementById('theme-toggle');
        const themeIcon = themeToggle?.querySelector('ix-icon');
        
        // Remove existing theme classes
        body.classList.remove('theme-classic-dark', 'theme-classic-light');
        body.removeAttribute('data-theme');
        
        if (theme === 'dark') {
            body.classList.add('theme-classic-dark');
            body.setAttribute('data-theme', 'dark');
            if (themeIcon) themeIcon.setAttribute('name', 'moon');
        } else {
            body.classList.add('theme-classic-light');
            body.setAttribute('data-theme', 'light');
            if (themeIcon) themeIcon.setAttribute('name', 'sun');
        }
    }

    /**
     * Toggle between light and dark theme
     */
    private toggleTheme(): void {
        const currentTheme = (document.body.getAttribute('data-theme') || 'light') as Theme;
        const newTheme: Theme = currentTheme === 'dark' ? 'light' : 'dark';
        
        this.setTheme(newTheme);
        localStorage.setItem('marketplace-theme', newTheme);
        
        this.showToast(`Switched to ${newTheme} theme`, 'info');
    }

    /**
     * Show connection information to help with debugging
     */
    private showConnectionInfo(): void {
        // Show a temporary info message about the connection
        setTimeout(() => {
            this.showToast(`Connecting to backend at ${this.baseUrl}`, 'info');
        }, 1000);
    }

    /**
     * Make API call with SSL certificate handling
     * Note: Browsers don't allow JavaScript to ignore SSL certificate errors for security.
     * For development with self-signed certificates, see the options in the constructor comments.
     */
    private async makeApiCall(endpoint: string, options: Partial<RequestInit> = {}): Promise<Response> {
        const url = `${this.baseUrl}${endpoint}`;

        try {
            const response = await fetch(url, options);
            return response;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`❌ API Call failed: ${url}`, error);
            
            // Handle SSL certificate errors
            if (errorMessage.includes('net::ERR_CERT') || 
                errorMessage.includes('SSL') || 
                errorMessage.includes('certificate')) {
                
                const sslError = new Error(
                    'SSL Certificate Error: The server uses an untrusted certificate. ' +
                    'For development: 1) Accept the certificate in your browser by visiting ' + 
                    this.baseUrl + ' directly, or 2) Use HTTP instead of HTTPS for local testing, or ' +
                    '3) Start your browser with --ignore-certificate-errors --ignore-ssl-errors flags.'
                ) as ApiError;
                sslError.isSSLError = true;
                throw sslError;
            }
            
            // Handle connection refused (server not running)
            if (errorMessage.includes('ERR_CONNECTION_REFUSED') || 
                errorMessage.includes('Failed to fetch')) {
                
                const connectionError = new Error(
                    `Connection Error: Cannot reach server at ${this.baseUrl}. ` +
                    `Please check: 1) WinCC OA Marketplace server is running, ` +
                    `2) Server is accessible at ${this.baseUrl}, ` +
                    `3) No firewall blocking the connection.`
                ) as ApiError;
                connectionError.isConnectionError = true;
                throw connectionError;
            }
            
            throw error;
        }
    }

    /**
     * Initialize all event listeners
     */
    private initializeEventListeners(): void {
        // Refresh button
        const refreshBtn = document.getElementById('refresh-btn');
        refreshBtn?.addEventListener('click', async () => {
            // Cancel any ongoing load operations
            this.cancelCurrentLoad();
            
            // Create new abort controller for this load operation
            this.currentLoadController = new AbortController();
            
            try {
                // Check current mode and refresh accordingly
                if (this.currentMode === 'registered') {
                    // In registered mode, reload all data and show registered repos
                    const orgSelect = document.getElementById('organization-select') as any;
                    const selectedValue = (orgSelect?.value || '').toString().trim();
                    
                    if (selectedValue) {
                        await this.loadRepositories(selectedValue);
                    } else {
                        await this.loadAllOrganizations();
                    }
                    
                    await Promise.all([
                        this.loadRegisteredProjects(),
                        this.loadLocalRepositories()
                    ]);
                    
                    this.showRegisteredRepositories();
                } else {
                    // In marketplace mode, load and show all repos
                    const orgSelect = document.getElementById('organization-select') as any;
                    const selectedValue = (orgSelect?.value || '').toString().trim();
                    
                    if (selectedValue) {
                        await this.loadRepositories(selectedValue);
                    } else {
                        await this.loadAllOrganizations();
                    }
                    
                    await Promise.all([
                        this.loadRegisteredProjects(),
                        this.loadLocalRepositories()
                    ]);
                    
                    this.renderRepositoryList();
                    this.populateKeywordFilter();
                }
            } catch (error: unknown) {
                // Ignore abort errors (user cancelled by clicking refresh again)
                if ((error as Error).name === 'AbortError') {
                    console.log('Refresh cancelled');
                    return;
                }
                throw error;
            }
        });

        // Search functionality
        const searchInput = document.getElementById('search-input');
        searchInput?.addEventListener('input', (e: Event) => {
            const target = e.target as HTMLInputElement;
            this.filterRepositories(target.value);
        });

        // Keyword filter
        const keywordFilter = document.getElementById('keyword-filter') as any;
        keywordFilter?.addEventListener('valueChange', (e: CustomEvent) => {
            // e.detail contains the array of selected values
            this.selectedKeywords = e.detail || [];
            this.applyFilters();
        });

        // Organization select with change event
        const orgSelect = document.getElementById('organization-select') as any;
        
        orgSelect?.addEventListener('valueChange', async (e: CustomEvent) => {
            // Cancel any ongoing load operations
            this.cancelCurrentLoad();
            
            // Create new abort controller for this load operation
            this.currentLoadController = new AbortController();
            
            try {
                const value = e.detail?.trim() || '';
                
                if (value) {
                    // Single organization selected or custom value entered
                    await this.loadRepositories(value);
                } else {
                    // Empty = load all predefined organizations
                    await this.loadAllOrganizations();
                }
                
                // Reload status information and render
                await Promise.all([
                    this.loadRegisteredProjects(),
                    this.loadLocalRepositories()
                ]);
                this.renderRepositoryList();
                this.populateKeywordFilter();
            } catch (error: unknown) {
                // Ignore abort errors (user changed organization while loading)
                if ((error as Error).name === 'AbortError') {
                    console.log('Organization change cancelled previous load');
                    return;
                }
                throw error;
            }
        });

        // Action buttons
        const cloneBtn = document.getElementById('clone-btn');
        
        cloneBtn?.addEventListener('click', () => {
            this.showCloneModal();
        });

        document.getElementById('pull-btn')?.addEventListener('click', () => {
            this.pullRepository();
        });

        const registerBtn = document.getElementById('register-btn');
        registerBtn?.addEventListener('click', () => {
            this.registerSubProject();
        });

        document.getElementById('unregister-btn')?.addEventListener('click', () => {
            this.unregisterSubProject();
        });

        // Tab switching
        this.initializeTabs();
        
        // Menu item listeners
        document.getElementById('marketplace-menu-item')?.addEventListener('click', () => {
            this.switchToMarketplaceMode();
        });
        
        document.getElementById('registered-projects-menu-item')?.addEventListener('click', () => {
            this.switchToRegisteredProjectsMode();
        });
        
        // Set marketplace as selected by default
        document.getElementById('marketplace-menu-item')?.setAttribute('selected', '');
        
        // Theme toggle button
        document.getElementById('theme-toggle')?.addEventListener('click', () => {
            this.toggleTheme();
        });
        
        // Initialize theme
        this.initializeTheme();
    }

    /**
     * Switch to marketplace mode (show all repositories from organization)
     */
    private async switchToMarketplaceMode(): Promise<void> {
        // Cancel any ongoing load operations
        this.cancelCurrentLoad();
        
        // Create new abort controller for this load operation
        this.currentLoadController = new AbortController();
        
        this.currentMode = 'marketplace';
        this.updateMenuSelection();
        this.updateTitle(); // Update title immediately before loading
        
        try {
            // Load organization repositories
            const orgSelect = document.getElementById('organization-select') as any;
            const selectedValue = (orgSelect?.value || '').toString().trim();
            
            if (selectedValue) {
                await this.loadRepositories(selectedValue);
            } else {
                await this.loadAllOrganizations();
            }
            
            // Load status information and render
            await Promise.all([
                this.loadRegisteredProjects(),
                this.loadLocalRepositories()
            ]);
            
            this.renderRepositoryList();
            this.populateKeywordFilter();
        } catch (error: unknown) {
            // Ignore abort errors (user cancelled by switching modes)
            if ((error as Error).name === 'AbortError') {
                console.log('Switch to marketplace cancelled');
                return;
            }
            throw error;
        }
    }

    /**
     * Switch to registered projects mode (show only registered repositories)
     */
    private async switchToRegisteredProjectsMode(): Promise<void> {
        // Cancel any ongoing load operations
        this.cancelCurrentLoad();
        
        // Create new abort controller for this load operation
        this.currentLoadController = new AbortController();
        
        this.currentMode = 'registered';
        this.updateMenuSelection();
        this.updateTitle(); // Update title immediately before loading
        
        try {
            // Load all repositories and status first
            const orgSelect = document.getElementById('organization-select') as any;
            const selectedValue = (orgSelect?.value || '').toString().trim();
            
            if (selectedValue) {
                await this.loadRepositories(selectedValue);
            } else {
                await this.loadAllOrganizations();
            }
            
            await Promise.all([
                this.loadRegisteredProjects(),
                this.loadLocalRepositories()
            ]);
            
            this.showRegisteredRepositories();
        } catch (error: unknown) {
            // Ignore abort errors (user cancelled by switching modes)
            if ((error as Error).name === 'AbortError') {
                console.log('Switch to registered projects cancelled');
                return;
            }
            throw error;
        }
    }

    /**
     * Update menu item selection visual state
     */
    private updateMenuSelection(): void {
        const marketplaceItem = document.getElementById('marketplace-menu-item');
        const registeredItem = document.getElementById('registered-projects-menu-item');
        
        // Remove selected state from both
        marketplaceItem?.removeAttribute('selected');
        registeredItem?.removeAttribute('selected');
        
        // Add selected state to current mode
        if (this.currentMode === 'marketplace') {
            marketplaceItem?.setAttribute('selected', '');
        } else {
            registeredItem?.setAttribute('selected', '');
        }
    }

    /**
     * Update the title based on current mode
     */
    private updateTitle(): void {
        const title = document.getElementById('repositories-title');
        const orgContainer = document.querySelector('.organization-selector');
        
        if (title) {
            if (this.currentMode === 'marketplace') {
                title.textContent = 'Marketplace';
                // Show organization input in marketplace mode
                if (orgContainer) {
                    (orgContainer as HTMLElement).style.display = '';
                }
            } else {
                title.textContent = 'Registered Projects';
                // Hide organization input in registered projects mode
                if (orgContainer) {
                    (orgContainer as HTMLElement).style.display = 'none';
                }
            }
        }
    }

    /**
     * Show only registered repositories in the list
     */
    private showRegisteredRepositories(): void {
        // Filter repositories to show only registered ones
        // Use subproject name (if available) or repository name for comparison
        const registeredRepos = this.repositories.filter(repo => {
            const nameToCheck = repo.subprojectName || repo.name;
            return this.registeredProjects.includes(nameToCheck);
        });
        
        // Temporarily store all repositories and replace with filtered ones
        const allRepositories = [...this.repositories];
        this.repositories = registeredRepos;
        
        // Render the filtered list
        this.renderRepositoryList();
        
        // Restore all repositories for future use
        this.repositories = allRepositories;
        
        // Show appropriate message if no registered projects
        if (registeredRepos.length === 0) {
            const container = document.getElementById('repository-list');
            if (container) {
                container.innerHTML = `
                    <div class="empty-state" style="padding: 48px 16px; text-align: center;">
                        <ix-icon name="shopping-cart" size="32" style="color: var(--theme-color-weak-text);"></ix-icon>
                        <p style="margin: 16px 0 0 0; color: var(--theme-color-weak-text);">No registered projects yet</p>
                        <p style="margin: 8px 0 0 0; color: var(--theme-color-weak-text); font-size: 14px;">Switch to Marketplace to find and register repositories</p>
                    </div>
                `;
            }
        }
    }

    /**
     * Initialize tab functionality
     */
    private initializeTabs(): void {
        const tabs = document.querySelectorAll('ix-tab-item');
        const tabPanes = document.querySelectorAll('.tab-pane');

        tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => {
                // Remove active class from all tabs and panes
                tabs.forEach(t => t.removeAttribute('selected'));
                tabPanes.forEach(pane => pane.classList.remove('active'));

                // Add active class to clicked tab and corresponding pane
                tab.setAttribute('selected', '');
                tabPanes[index]?.classList.add('active');

                // Load tab-specific content
                this.loadTabContent(index);
            });
        });
    }

    /**
     * Load initial data
     */
    private async loadInitialData(): Promise<void> {
        // Cancel any ongoing load operations
        this.cancelCurrentLoad();
        
        // Create new abort controller for this load operation
        this.currentLoadController = new AbortController();
        
        // Set initial title immediately
        this.updateTitle();
        
        try {
            // Load repositories and status information in sequence to ensure proper state
            await this.loadAllOrganizations(); // Load all organizations by default (don't render yet)
            await Promise.all([
                this.loadRegisteredProjects(),
                this.loadLocalRepositories() // Load local repository states
            ]);
            // Re-render with all status information loaded
            this.renderRepositoryList();
            this.populateKeywordFilter();
        } catch (error: unknown) {
            // Ignore abort errors (user cancelled by switching modes)
            if ((error as Error).name === 'AbortError') {
                console.log('Load operation cancelled');
                return;
            }
            throw error;
        }
    }

    /**
     * Cancel current load operation
     */
    private cancelCurrentLoad(): void {
        if (this.currentLoadController) {
            this.currentLoadController.abort();
            this.currentLoadController = null;
        }
    }

    /**
     * Load repositories from all predefined organizations
     */
    private async loadAllOrganizations(): Promise<void> {
        try {
            this.showLoading('repository-list');
            
            // Load repositories from all predefined organizations in parallel
            const promises = this.predefinedOrganizations.map(org => 
                this.makeApiCall(`/marketplace/listRepos?organization=${org}`, {
                    signal: this.currentLoadController?.signal
                })
                    .then(response => response.json())
                    .then(data => Array.isArray(data) ? data : [])
                    .catch((error) => {
                        // Ignore abort errors
                        if (error.name === 'AbortError') {
                            throw error; // Re-throw abort to propagate up
                        }
                        return []; // Ignore other errors for individual organizations
                    })
            );
            
            const results = await Promise.all(promises);
            
            // Combine all repositories
            this.repositories = results.flat();
            
            // Extract latest version from winccoaPackage field for all repos
            this.repositories.forEach(repo => {
                if ((repo as any).winccoaPackage) {
                    try {
                        const packageData = typeof (repo as any).winccoaPackage === 'string' 
                            ? JSON.parse((repo as any).winccoaPackage)
                            : (repo as any).winccoaPackage;
                        
                        if (packageData.Version) {
                            repo.latestVersion = packageData.Version;
                        }
                        
                        if (packageData.Keywords && Array.isArray(packageData.Keywords)) {
                            repo.keywords = packageData.Keywords;
                        }
                    } catch (e) {
                        console.warn(`Failed to parse winccoaPackage for ${repo.name}`);
                    }
                }
            });
            
            // Don't render here - will be rendered after all status info is loaded
            
            this.showToast(`Loaded ${this.repositories.length} repositories from all organizations`, 'success');
        } catch (error) {
            // Don't show error if request was aborted
            if ((error as Error).name !== 'AbortError') {
                this.showError('Failed to load repositories from all organizations');
            }
            this.repositories = [];
            // Don't render here - will be rendered after all status info is loaded
        }
    }

    /**
     * Load repositories from the API
     */
    private async loadRepositories(organization: string = 'winccoa'): Promise<void> {
        try {
            this.showLoading('repository-list');
            
            // Update the organization select to show current organization
            const orgSelect = document.getElementById('organization-select') as any;
            if (orgSelect && orgSelect.value !== organization) {
                orgSelect.value = organization;
            }
            
            const response = await this.makeApiCall(`/marketplace/listRepos?organization=${organization}`, {
                signal: this.currentLoadController?.signal
            });
            const data: Repository[] | { error?: string } = await response.json();
            
            if (response.ok) {
                this.repositories = Array.isArray(data) ? data : [];
                
                // Extract latest version from winccoaPackage field
                this.repositories.forEach(repo => {
                    if ((repo as any).winccoaPackage) {
                        try {
                            const packageData = typeof (repo as any).winccoaPackage === 'string' 
                                ? JSON.parse((repo as any).winccoaPackage)
                                : (repo as any).winccoaPackage;
                            
                            if (packageData.Version) {
                                repo.latestVersion = packageData.Version;
                            }
                            
                            if (packageData.Keywords && Array.isArray(packageData.Keywords)) {
                                repo.keywords = packageData.Keywords;
                            }
                        } catch (e) {
                            console.warn(`Failed to parse winccoaPackage for ${repo.name}`);
                        }
                    }
                });
                
                // Don't render here - will be rendered after all status info is loaded
                
                this.showToast(`Loaded ${this.repositories.length} repositories from ${organization}`, 'success');
            } else {
                const errorData = data as { error?: string };
                const errorMsg = errorData.error || 'Unknown error';
                this.showError(`Failed to load repositories from "${organization}": ${errorMsg}`);
                this.repositories = [];
                // Don't render here - will be rendered after all status info is loaded
            }
        } catch (error: unknown) {
            const apiError = error as ApiError;
            
            // Don't show error if request was aborted
            if (apiError.name !== 'AbortError') {
                let errorMessage = 'Failed to connect to marketplace service';
                
                if (apiError.isSSLError) {
                    errorMessage = 'SSL Certificate Issue: ' + apiError.message;
                } else if (apiError.isConnectionError) {
                    errorMessage = 'Connection Issue: ' + apiError.message;
                } else {
                    errorMessage = 'Network Error: ' + (apiError.message || 'Unknown error');
                }
                
                this.showError(errorMessage);
            }
            this.repositories = [];
            // Don't render here - will be rendered after all status info is loaded
        } finally {
            // Remove loading state from organization input
            const orgInput = document.getElementById('organization-input');
            orgInput?.removeAttribute('loading');
        }
    }

    /**
     * Load registered projects
     */
    private async loadRegisteredProjects(): Promise<void> {
        try {
            const response = await this.makeApiCall('/marketplace/listProjects', {
                signal: this.currentLoadController?.signal
            });
            if (response.ok) {
                const data: string[] = await response.json();
                this.registeredProjects = Array.isArray(data) ? data : [];
            }
        } catch (error: unknown) {
            const apiError = error as ApiError;
            if (apiError.name === 'AbortError') {
                throw error; // Re-throw abort errors
            }
            if (apiError.isSSLError) {
                console.warn('SSL Certificate Issue loading registered projects:', apiError.message);
            } else if (apiError.isConnectionError) {
                console.warn('Connection Issue loading registered projects:', apiError.message);
            } else {
                console.warn('Could not load registered projects:', apiError.message || 'Unknown error');
            }
            this.registeredProjects = [];
        }
    }

    /**
     * Load local repositories and merge with remote repository data
     */
    private async loadLocalRepositories(): Promise<void> {
        try {
            const response = await this.makeApiCall('/marketplace/listLocalRepos', {
                signal: this.currentLoadController?.signal
            });
            if (response.ok) {
                const localRepos: Array<{ addon: string; fileContent: any }> = await response.json();
                
                // Update repositories array with local information
                if (Array.isArray(localRepos)) {
                    localRepos.forEach(localRepo => {
                        // Find repository by name (addon name should match repository name)
                        const repo = this.repositories.find(r => r.name === localRepo.addon);
                        if (repo) {
                            // Mark as cloned
                            repo.cloned = true;
                            
                            // Store local file content as JSON string
                            repo.fileContent = JSON.stringify(localRepo.fileContent);
                            
                            // Extract subproject name from local content (for registration check)
                            if (localRepo.fileContent && localRepo.fileContent.Subproject) {
                                repo.subprojectName = localRepo.fileContent.Subproject;
                            }
                            
                            // Extract current version from local content
                            if (localRepo.fileContent && localRepo.fileContent.Version) {
                                repo.currentVersion = localRepo.fileContent.Version;
                                
                                // Compare with latest version from GitHub (if available)
                                if (repo.latestVersion) {
                                    repo.hasUpdate = repo.currentVersion !== repo.latestVersion;
                                } else {
                                    repo.hasUpdate = false;
                                }
                            }
                        }
                    });
                    
                    // Don't render here - will be rendered after all status info is loaded
                }
            }
        } catch (error: unknown) {
            const apiError = error as ApiError;
            if (apiError.name === 'AbortError') {
                throw error; // Re-throw abort errors
            }
            console.warn('Could not load local repositories:', apiError.message || 'Unknown error');
        }
    }

    /**
     * Fetch latest versions from remote repositories to compare with local versions
     */
    /**
     * Render the repository list
     */
    private renderRepositoryList(): void {
        const container = document.getElementById('repository-list');
        if (!container) return;
        
        if (this.repositories.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 48px 16px; text-align: center;">
                    <ix-icon name="error" size="32" style="color: var(--theme-color-weak-text);"></ix-icon>
                    <p style="margin: 16px 0 0 0; color: var(--theme-color-weak-text);">No repositories found</p>
                </div>
            `;
            return;
        }

        const repositoryItems = this.repositories.map(repo => {
            // Check if registered by comparing subproject name (if available) or repository name
            const nameToCheck = repo.subprojectName || repo.name;
            const isRegistered = this.registeredProjects.includes(nameToCheck);
            const statusClass = isRegistered ? 'registered' : (repo.cloned ? 'cloned' : '');
            const statusTooltip = isRegistered ? 'Registered' : (repo.cloned ? 'Cloned' : 'Not cloned');
            const isLoading = repo.loadingAction != null;
            const loadingText = repo.loadingAction 
                ? `${repo.loadingAction.charAt(0).toUpperCase() + repo.loadingAction.slice(1)} in progress...`
                : '';
            
            return `
                <div class="repository-item ${isLoading ? 'loading' : ''}" data-repo='${JSON.stringify(repo)}'>
                    <div class="repository-status ${statusClass}" title="${statusTooltip}"></div>
                    ${isLoading ? `
                        <div class="repository-loading-overlay">
                            <ix-spinner size="small"></ix-spinner>
                            <span class="loading-text">${loadingText}</span>
                        </div>
                    ` : ''}
                    <div class="repository-item-header">
                        <div class="repository-item-name">${repo.name}</div>
                        <ix-pill class="repository-item-visibility" variant="outline" size="small">
                            <ix-icon name="${repo.private ? 'lock' : 'unlock'}" slot="start"></ix-icon>
                            ${repo.private ? 'Private' : 'Public'}
                        </ix-pill>
                    </div>
                    <div class="repository-item-description">
                        ${repo.description || 'No description available'}
                    </div>
                    <div class="repository-item-meta">
                        <div class="repository-item-meta-item">
                            <ix-icon name="star-filled" size="12"></ix-icon>
                            <span>${repo.stars !== undefined && repo.stars !== null ? repo.stars : 'N/A'}&nbsp;${repo.stars !== 1 ? 'stars' : 'star'}</span>
                        </div>
                        <div class="repository-item-meta-item">
                            <ix-icon name="split" size="12"></ix-icon>
                            <span>${repo.forks !== undefined && repo.forks !== null ? repo.forks : 'N/A'}&nbsp;${repo.forks !== 1 ? 'forks' : 'fork'}</span>
                        </div>
                        <div class="repository-item-meta-item" title="Last updated: ${this.formatExactDate(repo.updatedAt)}">
                            <ix-icon name="clock" size="12"></ix-icon>
                            <span>${this.formatRelativeTime(repo.updatedAt)}</span>
                        </div>
                    </div>
                    ${repo.hasUpdate && repo.latestVersion ? `
                        <div class="repository-item-update-pill">
                            <ix-pill variant="warning" size="small" icon="arrow-up">
                                Update available (${repo.latestVersion})
                            </ix-pill>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        container.innerHTML = repositoryItems;

        // Add click listeners to repository items
        document.querySelectorAll('.repository-item').forEach(item => {
            item.addEventListener('click', (event: Event) => {
                const repoData = item.getAttribute('data-repo');
                if (repoData) {
                    const repo: Repository = JSON.parse(repoData);
                    this.selectRepository(repo, event);
                }
            });
        });
    }

    /**
     * Filter repositories based on search term
     */
    private filterRepositories(searchTerm: string): void {
        this.applyFilters();
    }

    /**
     * Apply all active filters (search + keywords)
     */
    private applyFilters(): void {
        const items = document.querySelectorAll('.repository-item');
        const searchInput = document.getElementById('search-input') as HTMLInputElement;
        const searchTerm = (searchInput?.value || '').toLowerCase();

        items.forEach(item => {
            const repoData = item.getAttribute('data-repo');
            if (repoData) {
                const repo: Repository = JSON.parse(repoData);
                
                // Check search term match
                const matchesSearch = !searchTerm || 
                    repo.name.toLowerCase().includes(searchTerm) ||
                    (repo.description && repo.description.toLowerCase().includes(searchTerm));
                
                // Check keyword filter match
                let matchesKeywords = true;
                if (this.selectedKeywords.length > 0) {
                    // If keywords are selected, repo must have ALL selected keywords
                    // Repos without keywords should be hidden when filter is active
                    if (repo.keywords && repo.keywords.length > 0) {
                        // Check if repo has ALL selected keywords
                        matchesKeywords = this.selectedKeywords.every(selectedKeyword => 
                            repo.keywords!.includes(selectedKeyword)
                        );
                    } else {
                        // No keywords on repo = don't match when filter is active
                        matchesKeywords = false;
                    }
                }
                
                // Show only if matches both filters
                (item as HTMLElement).style.display = (matchesSearch && matchesKeywords) ? 'block' : 'none';
            }
        });
    }

    /**
     * Populate keyword filter with all unique keywords from repositories
     */
    private populateKeywordFilter(): void {
        const keywordFilter = document.getElementById('keyword-filter') as any;
        if (!keywordFilter) return;
        
        // Clear existing options
        keywordFilter.innerHTML = '';
        
        // Collect all unique keywords
        const allKeywords = new Set<string>();
        this.repositories.forEach(repo => {
            if (repo.keywords && repo.keywords.length > 0) {
                repo.keywords.forEach(keyword => allKeywords.add(keyword));
            }
        });
        
        // Sort keywords alphabetically
        const sortedKeywords = Array.from(allKeywords).sort((a, b) => 
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
        
        // Add options to the select
        sortedKeywords.forEach(keyword => {
            const option = document.createElement('ix-select-item');
            option.setAttribute('label', keyword);
            option.setAttribute('value', keyword);
            keywordFilter.appendChild(option);
        });
    }

    /**
     * Select a repository and show its details
     */
    private selectRepository(repo: Repository, event: Event): void {
        // Update visual selection
        document.querySelectorAll('.repository-item').forEach(item => {
            item.classList.remove('selected');
        });
        
        (event.currentTarget as HTMLElement).classList.add('selected');
        
        // Store current repository
        this.currentRepository = repo;
        
        // Show details panel
        const emptyState = document.getElementById('empty-state');
        const repositoryDetail = document.getElementById('repository-detail');
        
        if (emptyState) emptyState.style.display = 'none';
        if (repositoryDetail) repositoryDetail.style.display = 'flex';
        
        // Update repository information
        this.updateRepositoryDetails(repo);
        
        // Update button spinner visibility based on loading state
        const spinner = document.getElementById('action-loading-spinner');
        if (spinner) {
            spinner.style.display = repo.loadingAction ? 'inline-block' : 'none';
        }
        
        // Load tab content
        this.loadTabContent(0); // Load overview tab by default
    }

    /**
     * Update repository details in the UI
     */
    private updateRepositoryDetails(repo: Repository): void {
        const repoName = document.getElementById('repo-name');
        const repoDescription = document.getElementById('repo-description');
        
        if (repoName) repoName.textContent = repo.name;
        if (repoDescription) repoDescription.textContent = repo.description || 'No description available';
        
        // Update status pills
        this.updateStatusPills(repo);
        
        // Update tags pills
        this.updateTagsPills(repo);
        
        // Update meta information
        const visibilityChip = document.getElementById('repo-visibility');
        const visibilityText = document.getElementById('repo-visibility-text');
        
        if (visibilityChip) visibilityChip.setAttribute('icon', repo.private ? 'lock-filled' : 'unlock-filled');
        if (visibilityText) visibilityText.textContent = repo.private ? 'Private' : 'Public';
        
        const repoStarsText = document.getElementById('repo-stars-text');
        const repoForksText = document.getElementById('repo-forks-text');

        if (repoStarsText) {
            const starsValue = repo.stars !== undefined && repo.stars !== null ? repo.stars : 'N/A';
            repoStarsText.textContent = `${starsValue} ${repo.stars !== 1 ? 'stars' : 'star'}`;
        }
        if (repoForksText) {
            const forksValue = repo.forks !== undefined && repo.forks !== null ? repo.forks : 'N/A';
            repoForksText.textContent = `${forksValue} ${repo.forks !== 1 ? 'forks' : 'fork'}`;
        }

        // Update overview tab
        const repoSize = document.getElementById('repo-size');
        const repoCreated = document.getElementById('repo-created');
        const repoUpdated = document.getElementById('repo-updated');
        
        if (repoSize) repoSize.textContent = this.formatSize(repo.size);
        if (repoCreated) repoCreated.textContent = this.formatExactDate(repo.createdAt);
        if (repoUpdated) repoUpdated.textContent = this.formatRelativeTime(repo.updatedAt, false);
        
        // Update fileContent display if available
        this.updateFileContentDisplay(repo);
        
        // Update local status and action buttons
        this.updateLocalStatus(repo);
    }

    /**
     * Update file content display in overview tab
     */
    private updateFileContentDisplay(repo: Repository): void {
        const metadataCard = document.getElementById('metadata-card');
        const fileContentElement = document.getElementById('file-content-json');
        
        if (repo.fileContent && metadataCard && fileContentElement) {
            try {
                // Parse and pretty-print the JSON
                const jsonObj = JSON.parse(repo.fileContent);
                fileContentElement.textContent = JSON.stringify(jsonObj, null, 2);
                metadataCard.style.display = 'block';
            } catch (error) {
                // If parsing fails, show the raw content
                fileContentElement.textContent = repo.fileContent;
                metadataCard.style.display = 'block';
            }
        } else if (metadataCard) {
            // Hide the metadata card if no fileContent
            metadataCard.style.display = 'none';
        }
    }

    /**
     * Update local status and action button states
     */
    private updateLocalStatus(repo: Repository): void {
        // Check if registered by comparing subproject name (if available) or repository name
        const nameToCheck = repo.subprojectName || repo.name;
        const isRegistered = this.registeredProjects.includes(nameToCheck);
        const isCloned = repo.cloned || false;
        const hasMetadata = !!repo.fileContent;
        const isLoading = !!repo.loadingAction;
        const hasUpdate = repo.hasUpdate || false;
        
        const statusElement = document.getElementById('local-status');
        const cloneBtn = document.getElementById('clone-btn');
        const pullBtn = document.getElementById('pull-btn');
        const registerBtn = document.getElementById('register-btn');
        const unregisterBtn = document.getElementById('unregister-btn');
        
        // Update version information display
        this.updateVersionInfo(repo);
        
        // Update status pills
        this.updateStatusPills(repo);
        
        // If repository is loading, disable all buttons
        if (isLoading) {
            cloneBtn?.setAttribute('disabled', '');
            pullBtn?.setAttribute('disabled', '');
            registerBtn?.setAttribute('disabled', '');
            unregisterBtn?.setAttribute('disabled', '');
            return; // Don't update status text while loading
        }
        
        if (isRegistered) {
            if (statusElement) {
                statusElement.innerHTML = `
                    <ix-icon name="success" class="status-icon" style="color: var(--theme-color-success);"></ix-icon>
                    <span>Registered as subproject</span>
                `;
            }
            cloneBtn?.setAttribute('disabled', '');
            // Only show pull button if there's an update available
            if (hasUpdate) {
                pullBtn?.removeAttribute('disabled');
            } else {
                pullBtn?.setAttribute('disabled', '');
            }
            registerBtn?.setAttribute('disabled', '');
            unregisterBtn?.removeAttribute('disabled');
        } else if (isCloned) {
            if (statusElement) {
                statusElement.innerHTML = `
                    <ix-icon name="download" class="status-icon" style="color: var(--theme-color-primary);"></ix-icon>
                    <span>Cloned locally</span>
                `;
            }
            cloneBtn?.setAttribute('disabled', '');
            // Only show pull button if there's an update available
            if (hasUpdate) {
                pullBtn?.removeAttribute('disabled');
            } else {
                pullBtn?.setAttribute('disabled', '');
            }
            
            // Only enable register button if metadata is available
            if (hasMetadata) {
                registerBtn?.removeAttribute('disabled');
            } else {
                registerBtn?.setAttribute('disabled', '');
            }
            
            unregisterBtn?.setAttribute('disabled', '');
        } else {
            if (statusElement) {
                statusElement.innerHTML = `
                    <ix-icon name="info" class="status-icon"></ix-icon>
                    <span>Not cloned locally</span>
                `;
            }
            cloneBtn?.removeAttribute('disabled');
            pullBtn?.setAttribute('disabled', '');
            registerBtn?.setAttribute('disabled', '');
            unregisterBtn?.setAttribute('disabled', '');
        }
    }

    /**
     * Update version information display
     */
    private updateVersionInfo(repo: Repository): void {
        const versionInfoContainer = document.getElementById('version-info');
        const currentVersionElement = document.getElementById('current-version');
        const latestVersionElement = document.getElementById('latest-version');
        const updateAvailableContainer = document.getElementById('update-available');
        
        if (repo.cloned && repo.currentVersion) {
            // Show version info
            if (versionInfoContainer) {
                versionInfoContainer.style.display = 'block';
            }
            
            // Display current version
            if (currentVersionElement) {
                currentVersionElement.textContent = repo.currentVersion;
            }
            
            // Display latest version if an update is available
            if (repo.hasUpdate && repo.latestVersion) {
                if (updateAvailableContainer) {
                    updateAvailableContainer.style.display = 'flex';
                }
                if (latestVersionElement) {
                    latestVersionElement.textContent = repo.latestVersion;
                }
            } else {
                // No update available, hide latest version
                if (updateAvailableContainer) {
                    updateAvailableContainer.style.display = 'none';
                }
            }
        } else {
            // Not cloned, hide version info
            if (versionInfoContainer) {
                versionInfoContainer.style.display = 'none';
            }
        }
    }

    /**
     * Update status pills between repo name and description
     */
    private updateStatusPills(repo: Repository): void {
        const pillsContainer = document.getElementById('repo-status-pills');
        if (!pillsContainer) return;
        
        // Clear existing pills
        pillsContainer.innerHTML = '';
        
        // Determine status
        const nameToCheck = repo.subprojectName || repo.name;
        const isRegistered = this.registeredProjects.includes(nameToCheck);
        const isCloned = repo.cloned || false;
        
        // Add version pill (if available)
        if (repo.currentVersion) {
            const versionPill = document.createElement('ix-pill');
            versionPill.setAttribute('variant', 'info');
            versionPill.setAttribute('icon', 'info');
            versionPill.setAttribute('tooltip-text', 'Current local version');
            versionPill.innerHTML = `Version ${repo.currentVersion}`;
            pillsContainer.appendChild(versionPill);
        }
        
        // Add status pill
        const statusPill = document.createElement('ix-pill');
        
        if (isRegistered) {
            statusPill.setAttribute('variant', 'success');
            statusPill.setAttribute('icon', 'success');
            statusPill.innerHTML = `Registered as subproject`;
        } else if (isCloned) {
            statusPill.setAttribute('variant', 'info');
            statusPill.setAttribute('icon', 'download');
            statusPill.innerHTML = `Cloned locally`;
        } else {
            statusPill.setAttribute('variant', 'neutral');
            statusPill.setAttribute('icon', 'info');
            statusPill.innerHTML = `Not cloned`;
        }
        
        pillsContainer.appendChild(statusPill);
        
        // Add update available pill (if applicable)
        if (repo.hasUpdate && repo.latestVersion) {
            const updatePill = document.createElement('ix-pill');
            updatePill.setAttribute('variant', 'warning');
            updatePill.setAttribute('icon', 'arrow-up');
            updatePill.innerHTML = `Update available (${repo.latestVersion})`;
            pillsContainer.appendChild(updatePill);
        }
    }

    /**
     * Update tags/keywords pills below status pills
     */
    private updateTagsPills(repo: Repository): void {
        const tagsSection = document.getElementById('repo-tags-section');
        const pillsContainer = document.getElementById('repo-tags-pills');
        if (!tagsSection || !pillsContainer) return;
        
        // Clear existing pills/text
        pillsContainer.innerHTML = '';
        
        // Check if keywords exist and are not empty
        if (repo.keywords && repo.keywords.length > 0) {
            // Create pills for each keyword
            repo.keywords.forEach(keyword => {
                const tagPill = document.createElement('ix-pill');
                tagPill.setAttribute('variant', 'neutral');
                tagPill.setAttribute('outline', '');
                tagPill.textContent = keyword;
                pillsContainer.appendChild(tagPill);
            });
        } else {
            // Show "No tags available" as text (not as pill)
            const noTagsText = document.createElement('span');
            noTagsText.className = 'no-tags-text';
            noTagsText.textContent = 'No tags available';
            pillsContainer.appendChild(noTagsText);
        }
    }

    /**
     * Show loading state for action buttons
     */
    /**
     * Show loading state for current repository only
     */
    private showActionLoading(): void {
        // Only show button spinner if we're viewing the repository that's loading
        // The repository list overlay will show for all repositories
        if (!this.currentRepository) return;
        
        const spinner = document.getElementById('action-loading-spinner');
        const cloneBtn = document.getElementById('clone-btn');
        const pullBtn = document.getElementById('pull-btn');
        const registerBtn = document.getElementById('register-btn');
        const unregisterBtn = document.getElementById('unregister-btn');
        
        // Show spinner only if we're viewing a repository with a loading action
        if (spinner && this.currentRepository.loadingAction) {
            spinner.style.display = 'inline-block';
        }
        
        // Disable all buttons only if current repository has a loading action
        if (this.currentRepository.loadingAction) {
            cloneBtn?.setAttribute('disabled', '');
            pullBtn?.setAttribute('disabled', '');
            registerBtn?.setAttribute('disabled', '');
            unregisterBtn?.setAttribute('disabled', '');
        }
    }

    /**
     * Hide loading state and restore button states
     */
    private hideActionLoading(): void {
        const spinner = document.getElementById('action-loading-spinner');
        
        // Hide spinner
        if (spinner) {
            spinner.style.display = 'none';
        }
        
        // Restore button states based on current repository
        if (this.currentRepository) {
            this.updateLocalStatus(this.currentRepository);
        }
    }

    /**
     * Load tab-specific content
     */
    private async loadTabContent(tabIndex: number): Promise<void> {
        if (!this.currentRepository) return;
        
        switch (tabIndex) {
            case 1: // README tab
                await this.loadReadme();
                break;
            case 2: // Files tab
                // Files functionality would be implemented here
                break;
        }
    }

    /**
     * Load repository README
     */
    private async loadReadme(): Promise<void> {
        const readmeContent = document.getElementById('readme-content');
        if (!readmeContent || !this.currentRepository) return;
        
        try {
            readmeContent.innerHTML = `
                <div class="loading-spinner">
                    <ix-spinner></ix-spinner>
                    <span>Loading README...</span>
                </div>
            `;
            
            // In a real implementation, you would fetch the README from GitHub API
            // For now, we'll simulate it
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            readmeContent.innerHTML = `
                <h1>${this.currentRepository.name}</h1>
                <p>${this.currentRepository.description || 'No description available'}</p>
                <h2>Installation</h2>
                <p>Clone this repository and follow the setup instructions.</p>
                <pre><code>git clone ${this.currentRepository.cloneUrl || this.currentRepository.sshUrl}</code></pre>
                <h2>Usage</h2>
                <p>Detailed usage instructions would be shown here from the actual README file.</p>
            `;
        } catch (error) {
            readmeContent.innerHTML = `
                <div style="text-align: center; padding: 48px; color: var(--theme-color-weak-text);">
                    <ix-icon name="alert-triangle" size="32"></ix-icon>
                    <p style="margin: 16px 0 0 0;">Failed to load README</p>
                </div>
            `;
        }
    }

    /**
     * Show clone modal using IX showMessage API
     */
    private async showCloneModal(): Promise<void> {
        console.log('🔧 showCloneModal called');
        
        if (!this.currentRepository) {
            this.showError('No repository selected');
            return;
        }
        
        try {
            // Fetch the default addon path from the backend
            const response = await this.makeApiCall('/marketplace/getDefaultAddonPath');
            
            if (!response.ok) {
                throw new Error('Failed to fetch default addon path');
            }
            
            const pathData = await response.json();
            
            // Extract the path from the array response
            const defaultPath = Array.isArray(pathData) && pathData.length > 0 
                ? pathData[0] 
                : 'Unknown path';
            
            // Calculate the full clone path
            const fullClonePath = `${defaultPath}${this.currentRepository.name}`;
            
            // Show confirmation dialog with the path
            if (typeof window.ixShowMessage === 'function') {
                const result = await window.ixShowMessage({
                    title: 'Clone Repository',
                    message: `Repository "${this.currentRepository.name}" will be cloned to\n\n${fullClonePath}`,
                    actions: [
                        {
                            text: 'Cancel'
                        },
                        {
                            text: 'Clone'
                        }
                    ]
                });
                
                // Handle the result based on which action was clicked
                if (result && result.actionIndex === 1) {
                    // User clicked "Clone"
                    await this.performClone(defaultPath);
                }
            } else {
                // Fallback to native confirm
                const confirmed = confirm(`Clone repository "${this.currentRepository.name}" to:\n\n${fullClonePath}\n\nContinue?`);
                if (confirmed) {
                    await this.performClone(defaultPath);
                }
            }
            
        } catch (error) {
            console.error('❌ Failed to fetch default addon path:', error);
            this.showError('Failed to get default clone path: ' + (error as Error).message);
        }
    }
    
    /**
     * Perform the actual clone operation
     */
    private async performClone(path: string): Promise<void> {
        if (!this.currentRepository) return;
        
        // Capture the repository being cloned to avoid issues if user switches repos during operation
        const repositoryBeingCloned = this.currentRepository;
        
        // Set loading state on the specific repository
        const repoIndex = this.repositories.findIndex(repo => repo.name === repositoryBeingCloned.name);
        if (repoIndex !== -1) {
            this.repositories[repoIndex].loadingAction = 'clone';
            // Also update currentRepository if it's the same one
            if (this.currentRepository?.name === repositoryBeingCloned.name) {
                this.currentRepository.loadingAction = 'clone';
            }
            this.renderRepositoryList(); // Re-render to show loading state
        }
        
        this.showActionLoading();
        
        try {
            const params = new URLSearchParams({
                url: repositoryBeingCloned.cloneUrl || repositoryBeingCloned.sshUrl || ''
            });
            
            if (path) {
                params.append('path', path);
            }
            
            const response = await this.makeApiCall(`/marketplace/clone?${params}`);
            
            if (response.ok) {
                // Parse the JSON response with repositoryPath and fileContent
                const data = await response.json();
                
                this.showSuccess('Repository cloned successfully');
                
                // Update the repository in the repositories array
                if (repoIndex !== -1) {
                    this.repositories[repoIndex].cloned = true;
                    this.repositories[repoIndex].loadingAction = null;
                    if (data.fileContent) {
                        this.repositories[repoIndex].fileContent = data.fileContent;
                    }
                    if (data.repositoryPath) {
                        this.repositories[repoIndex].localPath = data.repositoryPath;
                    }
                }
                
                // If this is still the current repository, update it and refresh UI
                if (this.currentRepository?.name === repositoryBeingCloned.name) {
                    this.currentRepository.cloned = true;
                    this.currentRepository.loadingAction = null;
                    if (data.fileContent) {
                        this.currentRepository.fileContent = data.fileContent;
                    }
                    if (data.repositoryPath) {
                        this.currentRepository.localPath = data.repositoryPath;
                    }
                    this.updateLocalStatus(this.currentRepository);
                    this.updateRepositoryDetails(this.currentRepository); // Refresh details to show fileContent
                }
                
                this.renderRepositoryList(); // Re-render to show updated status
            } else {
                const errorText = await response.text();
                this.showError('Failed to clone repository: ' + errorText);
            }
        } catch (error) {
            const apiError = error as ApiError;
            if (apiError.isSSLError) {
                this.showError('SSL Certificate Issue: ' + apiError.message);
            } else {
                this.showError('Failed to clone repository: ' + apiError.message);
            }
        } finally {
            // Clear loading state
            if (repoIndex !== -1) {
                this.repositories[repoIndex].loadingAction = null;
                this.renderRepositoryList();
            }
            this.hideActionLoading();
        }
    }
    
    /**
     * Wait for IX component to be ready
     */
    private async waitForComponentReady(element: HTMLElement): Promise<void> {
        // Wait for the element to be defined as a custom element
        if (element.tagName.toLowerCase().startsWith('ix-')) {
            await customElements.whenDefined(element.tagName.toLowerCase());
        }
        
        // Additional wait for hydration
        return new Promise(resolve => {
            if (element.classList.contains('hydrated')) {
                resolve();
            } else {
                const observer = new MutationObserver(() => {
                    if (element.classList.contains('hydrated')) {
                        observer.disconnect();
                        resolve();
                    }
                });
                observer.observe(element, { attributes: true, attributeFilter: ['class'] });
                
                // Timeout fallback
                setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, 1000);
            }
        });
    }

    /**
     * Pull repository updates
     */
    private async pullRepository(): Promise<void> {
        if (!this.currentRepository) return;
        
        // Capture the repository being pulled to avoid issues if user switches repos during operation
        const repositoryBeingPulled = this.currentRepository;
        
        // Set loading state on the specific repository
        const repoIndex = this.repositories.findIndex(repo => repo.name === repositoryBeingPulled.name);
        if (repoIndex !== -1) {
            this.repositories[repoIndex].loadingAction = 'pull';
            // Also update currentRepository if it's the same one
            if (this.currentRepository?.name === repositoryBeingPulled.name) {
                this.currentRepository.loadingAction = 'pull';
            }
            this.renderRepositoryList(); // Re-render to show loading state
        }
        
        this.showActionLoading();
        
        try {
            const repoName = repositoryBeingPulled.name;
            
            const response = await this.makeApiCall(`/marketplace/pull?repoName=${encodeURIComponent(repoName)}`);
            
            if (response.ok) {
                // Parse the JSON response with changes and fileContent
                const data = await response.json();
                
                // Update in repositories array
                if (repoIndex !== -1) {
                    if (data.fileContent) {
                        this.repositories[repoIndex].fileContent = data.fileContent;
                    }
                    this.repositories[repoIndex].loadingAction = null;
                }
                
                // If this is still the current repository, update it and refresh UI
                if (this.currentRepository?.name === repositoryBeingPulled.name) {
                    if (data.fileContent) {
                        this.currentRepository.fileContent = data.fileContent;
                    }
                    this.currentRepository.loadingAction = null;
                    // Refresh details to show updated fileContent
                    this.updateRepositoryDetails(this.currentRepository);
                }
                
                this.renderRepositoryList(); // Re-render to clear loading state
                
                // Show success message with number of changes
                if (data.changes !== undefined) {
                    const changesText = data.changes === 1 ? '1 change' : `${data.changes} changes`;
                    this.showSuccess(`Repository updated successfully (${changesText})`);
                } else {
                    this.showSuccess('Repository updated successfully');
                }
            } else {
                const errorText = await response.text();
                this.showError('Failed to update repository: ' + errorText);
            }
        } catch (error) {
            const apiError = error as ApiError;
            if (apiError.isSSLError) {
                this.showError('SSL Certificate Issue: ' + apiError.message);
            } else {
                this.showError('Failed to update repository: ' + apiError.message);
            }
        } finally {
            // Clear loading state
            if (repoIndex !== -1) {
                this.repositories[repoIndex].loadingAction = null;
                this.renderRepositoryList();
            }
            this.hideActionLoading();
        }
    }

    /**
     * Register subproject
     */
    private async registerSubProject(): Promise<void> {
        console.log('🔧 registerSubProject called');
        console.log('🔧 currentRepository:', this.currentRepository);
        
        if (!this.currentRepository) {
            return;
        }
        
        // Capture the repository being registered to avoid issues if user switches repos during operation
        const repositoryBeingRegistered = this.currentRepository;
        
        // Check if fileContent is available
        if (!repositoryBeingRegistered.fileContent) {
            this.showError('Cannot register: Repository metadata not available. Please clone or pull the repository first.');
            return;
        }
        
        // Check if repository is cloned
        if (!repositoryBeingRegistered.cloned) {
            this.showError('Cannot register: Repository is not cloned. Please clone the repository first.');
            return;
        }
        
        // Set loading state on the specific repository
        const repoIndex = this.repositories.findIndex(repo => repo.name === repositoryBeingRegistered.name);
        if (repoIndex !== -1) {
            this.repositories[repoIndex].loadingAction = 'register';
            // Also update currentRepository if it's the same one
            if (this.currentRepository?.name === repositoryBeingRegistered.name) {
                this.currentRepository.loadingAction = 'register';
            }
            this.renderRepositoryList(); // Re-render to show loading state
        }
        
        this.showActionLoading();
        
        try {
            const params = new URLSearchParams({
                repoName: repositoryBeingRegistered.name,
                fileContent: repositoryBeingRegistered.fileContent
            });
            
            const response = await this.makeApiCall(`/marketplace/registerSubProjects?${params}`);
            
            const result = await response.text();
            
            if (response.ok) {
                this.showSuccess('Subproject registered successfully');
                
                // Add the subproject name (not repository name) to registered projects
                const subprojectName = repositoryBeingRegistered.subprojectName || repositoryBeingRegistered.name;
                if (!this.registeredProjects.includes(subprojectName)) {
                    this.registeredProjects.push(subprojectName);
                }
                
                // Clear loading state
                if (repoIndex !== -1) {
                    this.repositories[repoIndex].loadingAction = null;
                }
                
                // If this is still the current repository, update UI
                if (this.currentRepository?.name === repositoryBeingRegistered.name) {
                    this.currentRepository.loadingAction = null;
                    this.updateLocalStatus(this.currentRepository);
                }
                
                this.renderRepositoryList(); // Refresh to show status change
            } else {
                this.showError('Failed to register subproject: ' + result);
            }
        } catch (error) {
            const apiError = error as ApiError;
            if (apiError.isSSLError) {
                this.showError('SSL Certificate Issue: ' + apiError.message);
            } else {
                this.showError('Failed to register subproject: ' + apiError.message);
            }
        } finally {
            // Clear loading state
            if (repoIndex !== -1) {
                this.repositories[repoIndex].loadingAction = null;
                this.renderRepositoryList();
            }
            this.hideActionLoading();
        }
    }

    /**
     * Unregister subproject
     */
    private async unregisterSubProject(): Promise<void> {
        if (!this.currentRepository) return;
        
        // Capture the repository being unregistered to avoid issues if user switches repos during operation
        const repositoryBeingUnregistered = this.currentRepository;
        
        // Check if fileContent is available
        if (!repositoryBeingUnregistered.fileContent) {
            this.showError('Cannot unregister: Repository metadata not available.');
            return;
        }
        
        // Check if repository is cloned
        if (!repositoryBeingUnregistered.cloned) {
            this.showError('Cannot unregister: Repository is not cloned.');
            return;
        }
        
        // Show confirmation modal with delete option
        const result = await window.ixShowUnregisterConfirm?.(repositoryBeingUnregistered.name);
        
        // If user cancelled, return
        if (!result || !result.confirmed) {
            return;
        }
        
        // Set loading state on the specific repository
        const repoIndex = this.repositories.findIndex(repo => repo.name === repositoryBeingUnregistered.name);
        if (repoIndex !== -1) {
            this.repositories[repoIndex].loadingAction = 'unregister';
            // Also update currentRepository if it's the same one
            if (this.currentRepository?.name === repositoryBeingUnregistered.name) {
                this.currentRepository.loadingAction = 'unregister';
            }
            this.renderRepositoryList(); // Re-render to show loading state
        }
        
        this.showActionLoading();
        
        try {
            // Pass the delete parameter and fileContent to the API
            const params = new URLSearchParams({
                repoName: repositoryBeingUnregistered.name,
                fileContent: repositoryBeingUnregistered.fileContent,
                deleteFiles: result.deleteRepository ? 'true' : 'false'
            });
            
            const response = await this.makeApiCall(`/marketplace/unregisterSubProjects?${params}`);
            const resultText = await response.text();
            
            if (response.ok) {
                const successMsg = result.deleteRepository 
                    ? 'Subproject unregistered and repository deleted successfully'
                    : 'Subproject unregistered successfully';
                this.showSuccess(successMsg);
                
                // Remove the subproject name (not repository name) from registered projects
                const subprojectName = repositoryBeingUnregistered.subprojectName || repositoryBeingUnregistered.name;
                const index = this.registeredProjects.indexOf(subprojectName);
                if (index > -1) {
                    this.registeredProjects.splice(index, 1);
                }
                
                // Update the repository in the repositories array
                if (repoIndex !== -1) {
                    // If repository was deleted, reset the cloned state
                    if (result.deleteRepository) {
                        this.repositories[repoIndex].cloned = false;
                        this.repositories[repoIndex].localPath = undefined;
                        this.repositories[repoIndex].fileContent = undefined;
                    }
                    this.repositories[repoIndex].loadingAction = null;
                }
                
                // If this is still the current repository, update it and refresh UI
                if (this.currentRepository?.name === repositoryBeingUnregistered.name) {
                    if (result.deleteRepository) {
                        this.currentRepository.cloned = false;
                        this.currentRepository.localPath = undefined;
                        this.currentRepository.fileContent = undefined;
                    }
                    this.currentRepository.loadingAction = null;
                    this.updateLocalStatus(this.currentRepository);
                }
                
                this.renderRepositoryList(); // Refresh to show status change
            } else {
                this.showError('Failed to unregister subproject: ' + resultText);
            }
        } catch (error) {
            const apiError = error as ApiError;
            if (apiError.isSSLError) {
                this.showError('SSL Certificate Issue: ' + apiError.message);
            } else {
                this.showError('Failed to unregister subproject: ' + apiError.message);
            }
        } finally {
            // Clear loading state
            if (repoIndex !== -1) {
                this.repositories[repoIndex].loadingAction = null;
                this.renderRepositoryList();
            }
            this.hideActionLoading();
        }
    }

    /**
     * Show loading state
     */
    private showLoading(containerId: string): void {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `
                <div class="loading-spinner">
                    <ix-spinner></ix-spinner>
                    <span>Loading...</span>
                </div>
            `;
        }
    }

    /**
     * Show success toast
     */
    private showSuccess(message: string): void {
        this.showToast(message, 'success');
    }

    /**
     * Show error toast
     */
    private showError(message: string): void {
        this.showToast(message, 'error');
    }

    /**
     * Show toast notification
     */
    public showToast(message: string, type: ToastType = 'info'): void {
        // Create toast element
        const toast = document.createElement('ix-toast') as any;
        
        // Set properties directly on the element (not as attributes)
        // This ensures proper type handling for Stencil web components
        toast.type = type;
        toast.textContent = message;
        
        // Configure auto-close behavior using JavaScript properties
        // autoClose is a boolean, autoCloseDelay is a number
        toast.autoClose = true;
        toast.autoCloseDelay = 5000;
        
        // Add to container
        const container = document.querySelector('ix-toast-container');
        container?.appendChild(toast);
        
        // Listen to the closeToast event to remove the toast from DOM
        // This event is emitted when:
        // - User clicks the close button
        // - Auto-close timer completes (respecting hover pause)
        toast.addEventListener('closeToast', () => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        });
    }

    /**
     * Format file size
     */
    private formatSize(sizeInKB?: number): string {
        if (!sizeInKB) return 'Unknown';
        
        if (sizeInKB < 1024) {
            return `${sizeInKB} KB`;
        } else if (sizeInKB < 1024 * 1024) {
            return `${(sizeInKB / 1024).toFixed(1)} MB`;
        } else {
            return `${(sizeInKB / (1024 * 1024)).toFixed(1)} GB`;
        }
    }


    /**
     * Format exact date and time
     */
    private formatExactDate(dateString: string): string {
        if (!dateString) return 'Unknown';
        
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(',', '');
    }

    /**
     * Format relative time with exact date
     */
    private formatRelativeTime(dateString: string, includeLineBreak: boolean = true): string {
        if (!dateString) return 'Unknown';
        
        const date = new Date(dateString);
        const now = new Date();
        const diffInMs = now.getTime() - date.getTime();
        const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
        const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
        const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
        
        let relativeText: string;
        
        if (diffInMinutes < 60) {
            if (diffInMinutes <= 1) {
                relativeText = 'just now';
            } else {
                relativeText = `${diffInMinutes} minutes ago`;
            }
        } else if (diffInHours < 24) {
            relativeText = `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
        } else if (diffInDays < 7) {
            relativeText = `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
        } else if (diffInDays < 30) {
            const weeks = Math.floor(diffInDays / 7);
            relativeText = `${weeks} week${weeks > 1 ? 's' : ''} ago`;
        } else if (diffInDays < 365) {
            const months = Math.floor(diffInDays / 30);
            relativeText = `${months} month${months > 1 ? 's' : ''} ago`;
        } else {
            const years = Math.floor(diffInDays / 365);
            relativeText = `${years} year${years > 1 ? 's' : ''} ago`;
        }
        
        // Format exact date: YYYY-MM-DD HH:MM
        const exactDate = this.formatExactDate(dateString);
        
        // Return with or without line break based on parameter
        const separator = includeLineBreak ? '<br>' : ' ';
        return `${relativeText}${separator}(${exactDate})`;
    }
}

