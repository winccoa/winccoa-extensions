# WinCC OA Add-on Extensions

A modular Extensions for SIMATIC WinCC OA to discover, install, update, and remove add-ons directly in your project.

- The Add-on Handler is implemented as a WinCC OA JavaScript Manager using the `winccoa-manager` Node.js package. This allows your service to access dp values/events and project services while leveraging the npm ecosystem for Extensions functionality.
- The Configuration UI talks to the WinCC OA HTTP Server via REST/WebSocket to trigger actions in the Add-on Handler.

References:
- WinCC OA JavaScript Manager basics and benefits: https://www.winccoa.com/documentation/WinCCOA/latest/en_US/NodeJS/topics/nodejs_basics.html
- `winccoa-manager` usage and basic configuration: https://www.winccoa.com/documentation/WinCCOA/latest/en_US/NodeJS/topics/nodejs_basic_configuration.html
- HTTP Server overview: https://www.winccoa.com/documentation/WinCCOA/latest/en_US/HTTP_Server/http1.html

## Prerequisites

- WinCC OA installed with:
  - Environment for JavaScript (Node.js manager support)
  - HTTP Server feature enabled for REST/WebSocket
- Node.js environment meeting WinCC OA requirements
- Optional: GitHub Personal Access Token for accessing private repositories or higher API rate limits (5000 vs 60 requests/hour)

## Setup

1. Install Extensions Add-on
   - Download or clone from GitHub: https://github.com/winccoa/winccoa-Extensions
   - Install npm packages: From the repository root, run `npm install` and `npm run build` (this builds both backend and frontend using npm workspaces)
     - To build separately: `npm run build:backend` or `npm run build:frontend`
   - Register in WinCC OA Project Administration.

2. Add sub-project to your project
   - Add to your project as sub-project via Project Administration or Console UI.
   - In the Console, add a JavaScript Manager with the script parameter pointing to your Node.js entry file `winccoa-Extensions/index.js`.
   - In the Console, add a Web Server (if not already existing).

3. Configure HTTP Server endpoints
   - An adapted `scripts\webclient_http.ctl` file is included in this sub-project. If you already have existing changes in this file, perform the following changes to it:
     - Locate `scripts\webclient_http.ctl` (in your project or sub-project directory).
     - Add the following `#uses` statement at the top of the file after all other `#uses` statements:
       ```
       #uses "classes/Extensions/ExtensionsEndpoints"
       ```
     - Add the Extensions endpoint connection after `http.start();` in the `main()` function:
       ```
       // connect endpoints for Extensions
       ExtensionsEndpoints::connectEndpoints(http.getHttpsPort());
       ```

4. Scaffold the Node.js module
   - In the WinCC OA `javascript` folder, create a module directory (e.g. `Extensions/`), initialize npm, and add `winccoa-manager` as a dependency.
   - Implement the service endpoints that the UI will call (vRPC handlers or REST hooks via HTTP Server).

5. Open the Web UI
   - Go to URL: https://localhost/data/Extensions/index.html

## Configuration

### Extensions.config.json

The `config/Extensions.config.json` file configures authentication methods, storage location, and custom repository sources for the Extensions.

**Complete Configuration Example:**
```json
{
  "authMethods": ["Token"],
  "storePath": "D:\\WinCC_OA_Proj\\3.21",
  "customRepos": [
    {
      "name": "Example Repository 1",
      "url": "https://github.com/user/example-repo-1.git"
    },
    {
      "name": "Example Repository 2",
      "url": "https://gitlab.com/user/example-repo-2.git"
    }
  ]
}
```

**Configuration Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `authMethods` | `string[]` | No | Array of authentication methods to enable. Currently supported: `["Token"]` for GitHub Personal Access Token authentication. If empty, missing, or file doesn't exist, falls back to public unauthenticated access. |
| `storePath` | `string` | No | Absolute path to the directory where add-ons will be installed. Must be an existing directory. If not specified or invalid, falls back to Windows registry 'PROJECTDIR' key, then the current working directory". Example: `"D:\\WinCC_OA_Proj\\3.21"` |
| `customRepos` | `object[]` | No | Array of custom repository sources to include in the Extensions. Each repository object requires `name` and `url` properties. |

## GitHub Authentication

The Extensions AddOn supports GitHub authentication to access private repositories and benefit from higher API rate limits.

### Authentication Methods

Authentication is configured in `config/Extensions.config.json`:
```json
{
  "authMethods": ["Token"],
}
```

**Supported Values:**
- `"Token"` - GitHub Personal Access Token authentication (currently the only implemented method)

**Behavior when not configured:**
- If `authMethods` is empty (`[]`) or missing the Extensions AddOn automatically falls back to **public, unauthenticated access**
- The Extensions will still function with limitations:
  - Only public repositories are accessible
  - Lower API rate limit: 60 requests/hour (vs 5000 with authentication)
  - No access to private or organization repositories

### Setting Up a GitHub Personal Access Token

1. **Create a Personal Access Token:**
   - Go to GitHub.com > Settings > Developer settings > Personal access tokens
   - Click "Generate new token (classic)" (recommended)
     - **Classic tokens** are simpler to configure and work across all repositories
     - **Fine-grained tokens** also supported but require more detailed permission setup
   - For classic tokens, select scopes:
     - `repo` (for private repositories)
     - `public_repo` (for public repositories only)
   - For fine-grained tokens, grant:
     - Repository access: Select specific repositories or all accessible repositories
     - Repository permissions: `Contents: Read` (and `Metadata: Read` for private repos)
   - Copy the token immediately (it's only shown once)

2. **Configure the Token:**

   **Option 1: Environment Variable (Recommended for Production)**
   - Windows PowerShell: `$env:GITHUB_TOKEN="ghp_your_token_here"`
   - Windows CMD: `set GITHUB_TOKEN=ghp_your_token_here`
   - Linux/Mac: `export GITHUB_TOKEN="ghp_your_token_here"`
   - For permanent setup, add to system environment variables

   **Option 2: .env File (For Development)**
   - Create a `.env` file in the workspace root directory (where this README is located)
   - Add the following line:
     ```
     GITHUB_TOKEN="ghp_your_token_here"
     ```
   - Replace `ghp_your_token_here` with your actual token
   - **Important:** Never commit the `.env` file to version control

3. **Verify Authentication:**
   - Restart the JavaScript Manager
   - Check the logs for:
     - `"Using GitHub token for authentication (Token method)"` - Success
     - `"Token authentication configured but no GitHub token found"` - Token not found
     - `"No authentication methods configured - using public access only"` - No auth configured

## Features

- Browse add-ons (from npm/GitHub registry)
- Install add-on into project (download, verify, place into subproject folder, trigger import if needed)
- Update add-on (version compare, changelog, safe restart if required)
- Remove add-on (cleanup)
