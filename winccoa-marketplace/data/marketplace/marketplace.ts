/**
 * WinCC OA Marketplace Web Interface TypeScript
 * Handles API integration and user interactions
 */

import type {
    Repository,
    ApiError,
    FetchOptions,
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
    private fetchOptions: FetchOptions;
    private currentMode: 'marketplace' | 'registered' = 'marketplace';

    constructor() {
        // Auto-detect backend URL based on current frontend URL
        // For development, you can override this by setting a specific URL
        this.baseUrl = window.location.origin;
        
        // Configure fetch for CORS and SSL handling
        this.fetchOptions = {
            mode: 'cors',
            // Use 'omit' for cross-origin requests to avoid CORS credential issues
            credentials: 'omit',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };
        
        // Debug: Check if IX components are loaded
        setTimeout(() => {
            console.log('🔧 IX Components loaded:', {
                ixButton: !!customElements.get('ix-button'),
                ixModal: !!customElements.get('ix-modal'),
                ixIcon: !!customElements.get('ix-icon'),
                ixIcons: !!window.ixIcons
            });
        }, 1000);
        
        // Show connection info to user
        this.showConnectionInfo();
        
        this.initializeEventListeners();
        this.loadInitialData();
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
        
        console.log(`🎨 Theme set to: ${theme}`);
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
        console.log(`🔗 Frontend URL: ${window.location.origin}`);
        console.log(`🔗 Backend URL: ${this.baseUrl}`);
        console.log(`📡 CORS Mode: ${this.fetchOptions.mode}`);
        console.log(`🔐 Credentials: ${this.fetchOptions.credentials}`);
        
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
        const fetchOptions: RequestInit = {
            ...this.fetchOptions,
            ...options
        };

        try {
            const response = await fetch(url, fetchOptions);
            return response;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`❌ API Call failed: ${url}`, error);
            
            // Handle different types of network errors
            if (errorMessage.includes('CORS') || errorMessage.includes('cors')) {
                const corsError = new Error(
                    `CORS Error: Cannot connect to ${this.baseUrl}. ` +
                    `Solutions: 1) Enable CORS on your WinCC OA server, ` +
                    `2) Use same origin (${window.location.origin}), or ` +
                    `3) Use a proxy or browser with disabled CORS for development.`
                ) as ApiError;
                corsError.isCORSError = true;
                throw corsError;
            }
            
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
        refreshBtn?.addEventListener('click', () => {
            const orgInput = document.getElementById('organization-input') as HTMLInputElement | null;
            const currentOrg = orgInput?.value?.trim() || 'winccoa';
            this.loadRepositories(currentOrg);
        });

        // Search functionality
        const searchInput = document.getElementById('search-input');
        searchInput?.addEventListener('input', (e: Event) => {
            const target = e.target as HTMLInputElement;
            this.filterRepositories(target.value);
        });

        // Organization input with debounced loading
        const orgInput = document.getElementById('organization-input') as HTMLInputElement | null;
        let orgInputTimer: number;
        
        orgInput?.addEventListener('input', (e: Event) => {
            const target = e.target as HTMLInputElement;
            const organization = target.value.trim();
            
            // Debounce the API call to avoid too many requests while typing
            clearTimeout(orgInputTimer);
            orgInputTimer = window.setTimeout(() => {
                if (organization) {
                    this.loadRepositories(organization);
                }
            }, 500); // Wait 500ms after user stops typing
        });
        
        // Also handle Enter key for immediate search
        orgInput?.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                clearTimeout(orgInputTimer);
                const target = e.target as HTMLInputElement;
                const organization = target.value.trim();
                if (organization) {
                    this.loadRepositories(organization);
                }
            }
        });

        // Action buttons
        const cloneBtn = document.getElementById('clone-btn');
        console.log('🔧 Clone button found:', cloneBtn);
        
        cloneBtn?.addEventListener('click', (e: Event) => {
            console.log('🔧 Clone button clicked!', e);
            this.showCloneModal();
        });

        document.getElementById('pull-btn')?.addEventListener('click', () => {
            this.pullRepository();
        });

        document.getElementById('register-btn')?.addEventListener('click', () => {
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
    private switchToMarketplaceMode(): void {
        this.currentMode = 'marketplace';
        this.updateMenuSelection();
        this.updateTitle();
        
        // Load organization repositories
        const orgInput = document.getElementById('organization-input') as HTMLInputElement | null;
        const currentOrg = orgInput?.value?.trim() || 'winccoa';
        this.loadRepositories(currentOrg);
    }

    /**
     * Switch to registered projects mode (show only registered repositories)
     */
    private switchToRegisteredProjectsMode(): void {
        this.currentMode = 'registered';
        this.updateMenuSelection();
        this.updateTitle();
        this.showRegisteredRepositories();
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
                const orgInput = document.getElementById('organization-input') as HTMLInputElement | null;
                const currentOrg = orgInput?.value?.trim() || 'winccoa';
                title.textContent = `${currentOrg} Repositories`;
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
        const registeredRepos = this.repositories.filter(repo => 
            this.registeredProjects.includes(repo.name)
        );
        
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
        await Promise.all([
            this.loadRepositories(),
            this.loadRegisteredProjects()
        ]);
    }

    /**
     * Load repositories from the API
     */
    private async loadRepositories(organization: string = 'winccoa'): Promise<void> {
        try {
            this.showLoading('repository-list');
            
            // Update the organization input to show current organization
            const orgInput = document.getElementById('organization-input') as HTMLInputElement | null;
            if (orgInput && orgInput.value !== organization) {
                orgInput.value = organization;
            }
            
            // Show loading feedback in the organization input
            orgInput?.setAttribute('loading', 'true');
            
            const response = await this.makeApiCall(`/marketplace/listRepos?organization=${organization}`);
            const data: Repository[] | { error?: string } = await response.json();
            
            if (response.ok) {
                this.repositories = Array.isArray(data) ? data : [];
                this.renderRepositoryList();
                
                // Update the title to show current organization
                const title = document.getElementById('repositories-title');
                if (title) {
                    title.textContent = `${organization} Repositories`;
                }
                
                this.showToast(`Loaded ${this.repositories.length} repositories from ${organization}`, 'success');
            } else {
                const errorData = data as { error?: string };
                const errorMsg = errorData.error || 'Unknown error';
                this.showError(`Failed to load repositories from "${organization}": ${errorMsg}`);
                this.repositories = [];
                this.renderRepositoryList();
                
                // Reset title on error
                const title = document.getElementById('repositories-title');
                if (title) {
                    title.textContent = 'Available Repositories';
                }
            }
        } catch (error: unknown) {
            let errorMessage = 'Failed to connect to marketplace service';
            
            const apiError = error as ApiError;
            if (apiError.isCORSError) {
                errorMessage = 'CORS Issue: ' + apiError.message;
            } else if (apiError.isSSLError) {
                errorMessage = 'SSL Certificate Issue: ' + apiError.message;
            } else if (apiError.isConnectionError) {
                errorMessage = 'Connection Issue: ' + apiError.message;
            } else {
                errorMessage = 'Network Error: ' + (apiError.message || 'Unknown error');
            }
            
            this.showError(errorMessage);
            this.repositories = [];
            this.renderRepositoryList();
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
            const response = await this.makeApiCall('/marketplace/listProjects');
            if (response.ok) {
                const data: string[] = await response.json();
                this.registeredProjects = Array.isArray(data) ? data : [];
            }
        } catch (error: unknown) {
            const apiError = error as ApiError;
            if (apiError.isCORSError) {
                console.warn('CORS Issue loading registered projects:', apiError.message);
            } else if (apiError.isSSLError) {
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
     * Render the repository list
     */
    private renderRepositoryList(): void {
        const container = document.getElementById('repository-list');
        if (!container) return;
        
        if (this.repositories.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 48px 16px; text-align: center;">
                    <ix-icon name="inbox" size="32" style="color: var(--theme-color-weak-text);"></ix-icon>
                    <p style="margin: 16px 0 0 0; color: var(--theme-color-weak-text);">No repositories found</p>
                </div>
            `;
            return;
        }

        const repositoryItems = this.repositories.map(repo => {
            const isRegistered = this.registeredProjects.includes(repo.name);
            const statusClass = isRegistered ? 'registered' : (repo.cloned ? 'cloned' : '');
            
            return `
                <div class="repository-item" data-repo='${JSON.stringify(repo)}'>
                    <div class="repository-status ${statusClass}"></div>
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
                        <div class="repository-item-meta-item" title="${repo.stars} star${repo.stars !== 1 ? 's' : ''}">
                            <ix-icon name="star-filled" size="12"></ix-icon>
                            <span>${repo.stars || 0}&nbsp;${repo.stars !== 1 ? 'stars' : 'star'}</span>
                        </div>
                        <div class="repository-item-meta-item" title="${repo.forks} fork${repo.forks !== 1 ? 's' : ''}">
                            <ix-icon name="split" size="12"></ix-icon>
                            <span>${repo.forks || 0}&nbsp;${repo.forks !== 1 ? 'forks' : 'fork'}</span>
                        </div>
                        <div class="repository-item-meta-item" title="Last updated: ${this.formatExactDate(repo.updatedAt)}">
                            <ix-icon name="clock" size="12"></ix-icon>
                            <span>${this.formatRelativeTime(repo.updatedAt)}</span>
                        </div>
                    </div>
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
        const items = document.querySelectorAll('.repository-item');
        const term = searchTerm.toLowerCase();

        items.forEach(item => {
            const repoData = item.getAttribute('data-repo');
            if (repoData) {
                const repo: Repository = JSON.parse(repoData);
                const matches = repo.name.toLowerCase().includes(term) ||
                              (repo.description && repo.description.toLowerCase().includes(term));
                
                (item as HTMLElement).style.display = matches ? 'block' : 'none';
            }
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
        
        // Update meta information
        const visibilityChip = document.getElementById('repo-visibility');
        const visibilityText = document.getElementById('repo-visibility-text');
        
        if (visibilityChip) visibilityChip.setAttribute('icon', repo.private ? 'lock-filled' : 'unlock-filled');
        if (visibilityText) visibilityText.textContent = repo.private ? 'Private' : 'Public';
        
        const repoStarsText = document.getElementById('repo-stars-text');
        const repoForksText = document.getElementById('repo-forks-text');

        if (repoStarsText) repoStarsText.textContent = `${repo.stars || 0} ${repo.stars !== 1 ? 'stars' : 'star'}`;
        if (repoForksText) repoForksText.textContent = `${repo.forks || 0} ${repo.forks !== 1 ? 'forks' : 'fork'}`;

        // Update overview tab
        const repoSize = document.getElementById('repo-size');
        const repoCreated = document.getElementById('repo-created');
        const repoUpdated = document.getElementById('repo-updated');
        
        if (repoSize) repoSize.textContent = this.formatSize(repo.size);
        if (repoCreated) repoCreated.textContent = this.formatExactDate(repo.createdAt);
        if (repoUpdated) repoUpdated.textContent = this.formatRelativeTime(repo.updatedAt, false);
        
        // Update local status and action buttons
        this.updateLocalStatus(repo);
    }

    /**
     * Update local status and action button states
     */
    private updateLocalStatus(repo: Repository): void {
        const isRegistered = this.registeredProjects.includes(repo.name);
        const isCloned = repo.cloned || false; // This would need to be determined by checking local filesystem
        
        const statusElement = document.getElementById('local-status');
        const cloneBtn = document.getElementById('clone-btn');
        const pullBtn = document.getElementById('pull-btn');
        const registerBtn = document.getElementById('register-btn');
        const unregisterBtn = document.getElementById('unregister-btn');
        
        if (isRegistered) {
            if (statusElement) {
                statusElement.innerHTML = `
                    <ix-icon name="success" class="status-icon" style="color: var(--theme-color-success);"></ix-icon>
                    <span>Registered as subproject</span>
                `;
            }
            cloneBtn?.setAttribute('disabled', '');
            pullBtn?.removeAttribute('disabled');
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
            pullBtn?.removeAttribute('disabled');
            registerBtn?.removeAttribute('disabled');
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
        console.log('🔧 window.ixShowMessage type:', typeof window.ixShowMessage);
        console.log('🔧 window.ixShowMessage value:', window.ixShowMessage);
        
        // Check if IX showMessage is available from our import
        if (typeof window.ixShowMessage !== 'function') {
            console.error('❌ IX showMessage not available - falling back to IX input');
            // Fallback to IX input modal
            if (typeof window.ixShowInput === 'function') {
                const path = await window.ixShowInput({
                    title: 'Clone Repository',
                    message: 'Enter the local path where you want to clone the repository:',
                    label: 'Local Path:',
                    placeholder: 'Leave empty for default location',
                    defaultValue: ''
                });
                if (path !== null) {
                    await this.performClone(path || '');
                }
            } else {
                // Final fallback to native prompt
                const path = prompt('Enter local path for cloning (or leave empty for default):');
                if (path !== null) {
                    await this.performClone(path || '');
                }
            }
            return;
        }
        
        try {
            console.log('🔧 Using IX showMessage for clone dialog');
            
            // Use IX showMessage API correctly - it returns a promise that resolves when user clicks an action
            const result = await window.ixShowMessage({
                message: 'Choose where to clone the repository',
                actions: [
                    {
                        text: 'Cancel'
                    },
                    {
                        text: 'Clone to Default'
                    },
                    {
                        text: 'Choose Path'
                    }
                ]
            });
            
            console.log('🔧 IX showMessage result:', result);
            
            // Handle the result based on which action was clicked
            if (result && result.actionIndex !== undefined) {
                switch (result.actionIndex) {
                    case 0: // Cancel
                        console.log('🔧 Clone cancelled');
                        break;
                    case 1: // Clone to Default
                        console.log('🔧 Clone to default path');
                        await this.performClone('');
                        break;
                    case 2: // Choose Path
                        console.log('🔧 Choose custom path');
                        if (typeof window.ixShowInput === 'function') {
                            const path = await window.ixShowInput({
                                title: 'Choose Clone Path',
                                message: 'Enter the local path where you want to clone the repository:',
                                label: 'Local Path:',
                                placeholder: 'e.g., /path/to/directory or C:\\projects\\repo',
                                defaultValue: ''
                            });
                            if (path !== null) {
                                await this.performClone(path);
                            }
                        } else {
                            // Fallback to native prompt
                            const path = prompt('Enter local path:');
                            if (path !== null) {
                                await this.performClone(path);
                            }
                        }
                        break;
                }
            }
            
        } catch (error) {
            console.error('❌ Failed to open IX showMessage:', error);
            // Fallback to IX input modal
            if (typeof window.ixShowInput === 'function') {
                const path = await window.ixShowInput({
                    title: 'Clone Repository',
                    message: 'Enter the local path where you want to clone the repository:',
                    label: 'Local Path:',
                    placeholder: 'Leave empty for default location',
                    defaultValue: ''
                });
                if (path !== null) {
                    await this.performClone(path || '');
                }
            } else {
                // Final fallback to native prompt
                const path = prompt('Enter local path for cloning (or leave empty for default):');
                if (path !== null) {
                    await this.performClone(path || '');
                }
            }
        }
    }
    
    /**
     * Perform the actual clone operation
     */
    private async performClone(path: string): Promise<void> {
        if (!this.currentRepository) return;
        
        try {
            const params = new URLSearchParams({
                url: this.currentRepository.cloneUrl || this.currentRepository.sshUrl || ''
            });
            
            if (path) {
                params.append('path', path);
            }
            
            const response = await this.makeApiCall(`/marketplace/cloneRepo?${params}`);
            const result = await response.text();
            
            if (response.ok) {
                this.showSuccess('Repository cloned successfully');
                this.currentRepository.cloned = true;
                
                // Also update the repository in the repositories array
                const repoIndex = this.repositories.findIndex(repo => repo.name === this.currentRepository!.name);
                if (repoIndex !== -1) {
                    this.repositories[repoIndex].cloned = true;
                }
                
                this.updateLocalStatus(this.currentRepository);
                this.renderRepositoryList(); // Re-render to show updated status
            } else {
                this.showError('Failed to clone repository: ' + result);
            }
        } catch (error) {
            const apiError = error as ApiError;
            if (apiError.isSSLError) {
                this.showError('SSL Certificate Issue: ' + apiError.message);
            } else {
                this.showError('Failed to clone repository: ' + apiError.message);
            }
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
     * Clone repository (legacy method for compatibility)
     */
    public async confirmClone(): Promise<void> {
        if (!this.currentRepository) return;
        
        const pathInput = document.getElementById('clone-path-input') as HTMLInputElement | null;
        const path = pathInput?.value.trim() || '';
        
        try {
            const params = new URLSearchParams({
                url: this.currentRepository.cloneUrl || this.currentRepository.sshUrl || ''
            });
            
            if (path) {
                params.append('path', path);
            }
            
            const response = await this.makeApiCall(`/marketplace/cloneRepo?${params}`);
            const result = await response.text();
            
            if (response.ok) {
                this.showSuccess('Repository cloned successfully');
                this.currentRepository.cloned = true;
                
                // Also update the repository in the repositories array
                const repoIndex = this.repositories.findIndex(repo => repo.name === this.currentRepository!.name);
                if (repoIndex !== -1) {
                    this.repositories[repoIndex].cloned = true;
                }
                
                this.updateLocalStatus(this.currentRepository);
                this.renderRepositoryList(); // Re-render to show updated status
            } else {
                this.showError('Failed to clone repository: ' + result);
            }
        } catch (error) {
            const apiError = error as ApiError;
            if (apiError.isSSLError) {
                this.showError('SSL Certificate Issue: ' + apiError.message);
            } else {
                this.showError('Failed to clone repository: ' + apiError.message);
            }
        }
    }

    /**
     * Pull repository updates
     */
    private async pullRepository(): Promise<void> {
        if (!this.currentRepository) return;
        
        try {
            const response = await this.makeApiCall(`/marketplace/pullRepo?repo=${encodeURIComponent(this.currentRepository.name)}`);
            const result = await response.text();
            
            if (response.ok) {
                this.showSuccess('Repository updated successfully');
            } else {
                this.showError('Failed to update repository: ' + result);
            }
        } catch (error) {
            const apiError = error as ApiError;
            if (apiError.isSSLError) {
                this.showError('SSL Certificate Issue: ' + apiError.message);
            } else {
                this.showError('Failed to update repository: ' + apiError.message);
            }
        }
    }

    /**
     * Register subproject
     */
    private async registerSubProject(): Promise<void> {
        if (!this.currentRepository) return;
        
        try {
            const response = await this.makeApiCall(`/marketplace/regSubProject?path=${encodeURIComponent(this.currentRepository.name)}`);
            const result = await response.text();
            
            if (response.ok) {
                this.showSuccess('Subproject registered successfully');
                this.registeredProjects.push(this.currentRepository.name);
                this.updateLocalStatus(this.currentRepository);
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
        }
    }

    /**
     * Unregister subproject
     */
    private async unregisterSubProject(): Promise<void> {
        if (!this.currentRepository) return;
        
        try {
            const response = await this.makeApiCall(`/marketplace/unregister?path=${encodeURIComponent(this.currentRepository.name)}`);
            const result = await response.text();
            
            if (response.ok) {
                this.showSuccess('Subproject unregistered successfully');
                const index = this.registeredProjects.indexOf(this.currentRepository.name);
                if (index > -1) {
                    this.registeredProjects.splice(index, 1);
                }
                this.updateLocalStatus(this.currentRepository);
                this.renderRepositoryList(); // Refresh to show status change
            } else {
                this.showError('Failed to unregister subproject: ' + result);
            }
        } catch (error) {
            const apiError = error as ApiError;
            if (apiError.isSSLError) {
                this.showError('SSL Certificate Issue: ' + apiError.message);
            } else {
                this.showError('Failed to unregister subproject: ' + apiError.message);
            }
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
        const toast = document.createElement('ix-toast');
        toast.setAttribute('type', type);
        toast.textContent = message;
        
        // Add to container
        const container = document.querySelector('ix-toast-container');
        container?.appendChild(toast);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 5000);
    }

    /**
     * Format file size
     */
    private formatSize(sizeInKB?: number): string {
        if (!sizeInKB) return '0 KB';
        
        if (sizeInKB < 1024) {
            return `${sizeInKB} KB`;
        } else if (sizeInKB < 1024 * 1024) {
            return `${(sizeInKB / 1024).toFixed(1)} MB`;
        } else {
            return `${(sizeInKB / (1024 * 1024)).toFixed(1)} GB`;
        }
    }

    /**
     * Format date for display (kept for compatibility)
     */
    private formatDate(dateString: string): string {
        return this.formatExactDate(dateString);
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

