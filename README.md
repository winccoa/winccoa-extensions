# WinCC OA Extensions

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
   - Download or clone from GitHub: https://github.com/winccoa/winccoa-extensions
   - Install npm packages: From the repository root, run `npm install` and `npm run build` (this builds both backend and frontend using npm workspaces)
     - To build separately: `npm run build:backend` or `npm run build:frontend`
   - Register the project in *WinCC OA Project Administration* by selecting *Register New Project* (default keyboard shortcut: *Ctrl + R*), then choose the `winccoa-extensions` folder created in the previous step containing all configs, scripts etc.

2. Add sub-project to your project
   - Add to your project as sub-project via Project Administration or Console UI.
   - In the Console, add an additional JavaScript Manager with the script parameter pointing to your Node.js entry file `winccoa-extensions/index.js`.
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

### extensions.config.json

The `config/extensions.config.json` file configures authentication methods, storage location, and custom repository sources for the Extensions.

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

## Add-on Manifest (`package.winccoa.json`)

Every installable extension repository must contain a `package.winccoa.json` file in its repository root. This manifest describes the add-on metadata, compatibility, dependencies, and any WinCC OA subprojects that should be registered during installation.

### Schema

```jsonc
{
  // ── Required fields ──────────────────────────────────────────
  "RepoName": "my-extension",        // Display name of the add-on
  "Version": "1.0.0",                // Semantic version
  "Description": "Does something",  // Human-readable description
  "OaVersion": "2025 SP1",           // Compatible WinCC OA version

  // ── Optional fields ──────────────────────────────────────────
  "Keywords": ["scada", "hmi"],

  "Dependencies": [
    "https://github.com/org/dep-repo.git"
  ],

  "Subprojects": [
    {
      // Required
      "Name": "my-subproject",

      // Optional
      "Description": "Subproject description",

      "Managers": [
        {
          "Name": "ManagerName",
          "StartMode": "always",
          "Options": "-option1 -option2",
          "RestartOnUpdate": true
        }
      ],

      "Dplists": [
        "dplist.ascii"
      ],

      "UpdateScripts": [
        "update.ctl"
      ],

      "UninstallScripts": [
        "uninstall.ctl"
      ]
    }
  ]
}
```

### Field Reference

| Field | Required | Description |
|--------|----------|-------------|
| `RepoName` | Yes | Display name shown in the Extensions UI. |
| `Version` | Yes | Add-on version used for display and update detection. |
| `Description` | Yes | Short human-readable description of the add-on. |
| `OaVersion` | Yes | Target WinCC OA version. Add-ons targeting incompatible versions are filtered out. |
| `Keywords` | No | Tags used for searching and filtering in the Extensions UI. Defaults to an empty array. |
| `Dependencies` | No | List of Git repository URLs that are cloned and installed recursively. Each dependency repository must also contain its own `package.winccoa.json`. |
| `Subprojects[].Name` | Yes | Name used when registering the WinCC OA subproject. |
| `Subprojects[].Description` | No | Description of the subproject. |
| `Subprojects[].Managers` | No | Manager processes that should be registered for the subproject. |
| `Subprojects[].Managers[].Name` | Yes | Name of the manager process. |
| `Subprojects[].Managers[].StartMode` | No | Manager start mode. Supported values are `"always"`, `"manual"`, `"once"`, or `""`. |
| `Subprojects[].Managers[].Options` | No | Command-line options passed to the manager. |
| `Subprojects[].Managers[].RestartOnUpdate` | No | Whether the manager should automatically restart after an update. Defaults to `true`. |
| `Subprojects[].Dplists` | No | ASCII data point list files imported using the AsciiManager. |
| `Subprojects[].UpdateScripts` | No | Control scripts executed after the add-on has been updated. |
| `Subprojects[].UninstallScripts` | No | Control scripts executed when the add-on is removed. |

### Example

```json
{
  "RepoName": "Example Extension",
  "Version": "1.2.0",
  "Description": "Adds example functionality",
  "OaVersion": "^3.21.0",
  "Keywords": ["example", "scada"],
  "Dependencies": [
    "https://github.com/company/shared-library.git"
  ],
  "Subprojects": [
    {
      "Name": "ExampleExtension",
      "Description": "Registers the example extension",
      "Managers": [
        {
          "Name": "WCCOActrl",
          "StartMode": "always",
          "Options": "feature.ctl -dbg 10",
          "RestartOnUpdate": true
        }
      ],
      "Dplists": [
        "dptypes.dpl"
      ],
      "UpdateScripts": [
        "update.ctl"
      ],
      "UninstallScripts": [
        "uninstall.ctl"
      ]
    }
  ]
}
```

### Notes

- `RepoName`, `Version`, `Description`, and `OaVersion` are mandatory for every add-on.
- All dependency repositories must also provide a valid `package.winccoa.json`.
- Dependencies are installed recursively before the parent add-on.
- Repositories targeting an incompatible `OaVersion` are not shown in the Extensions UI.
- Omitting optional arrays (`Keywords`, `Dependencies`, `Subprojects`, `Dplists`, etc.) is equivalent to providing empty arrays.

## GitHub Authentication

The Extensions AddOn supports GitHub authentication to access private repositories and benefit from higher API rate limits.

### Authentication Methods

Authentication is configured in `config/extensions.config.json`:
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

## Add-on Manifest (`package.winccoa.json`)

Every installable extension repository must contain a `package.winccoa.json` file in its repository root. This manifest describes the add-on metadata, compatibility, dependencies, and any WinCC OA subprojects that should be registered during installation.

### Schema

```jsonc
{
  // ── Required fields ──────────────────────────────────────────
  "RepoName": "my-extension",        // Display name of the add-on
  "Version": "1.0.0",                // Semantic version
  "Description": "Does something",  // Human-readable description
  "OaVersion": "2025 SP1",           // Compatible WinCC OA version

  // ── Optional fields ──────────────────────────────────────────
  "Keywords": ["scada", "hmi"],

  "Dependencies": [
    "https://github.com/org/dep-repo.git"
  ],

  "Subprojects": [
    {
      // Required
      "Name": "my-subproject",

      // Optional
      "Description": "Subproject description",

      "Managers": [
        {
          "Name": "ManagerName",
          "StartMode": "always",
          "Options": "-option1 -option2",
          "RestartOnUpdate": true
        }
      ],

      "Dplists": [
        "dplist.ascii"
      ],

      "UpdateScripts": [
        "update.ctl"
      ],

      "UninstallScripts": [
        "uninstall.ctl"
      ]
    }
  ]
}
```

### Field Reference

| Field | Required | Description |
|--------|----------|-------------|
| `RepoName` | Yes | Display name shown in the Extensions UI. |
| `Version` | Yes | Add-on version used for display and update detection. |
| `Description` | Yes | Short human-readable description of the add-on. |
| `OaVersion` | Yes | Target WinCC OA version. Add-ons targeting incompatible versions are filtered out. |
| `Keywords` | No | Tags used for searching and filtering in the Extensions UI. Defaults to an empty array. |
| `Dependencies` | No | List of Git repository URLs that are cloned and installed recursively. Each dependency repository must also contain its own `package.winccoa.json`. |
| `Subprojects[].Name` | Yes | Name used when registering the WinCC OA subproject. |
| `Subprojects[].Description` | No | Description of the subproject. |
| `Subprojects[].Managers` | No | Manager processes that should be registered for the subproject. |
| `Subprojects[].Managers[].Name` | Yes | Name of the manager process. |
| `Subprojects[].Managers[].StartMode` | No | Manager start mode. Supported values are `"always"`, `"manual"`, `"once"`, or `""`. |
| `Subprojects[].Managers[].Options` | No | Command-line options passed to the manager. |
| `Subprojects[].Managers[].RestartOnUpdate` | No | Whether the manager should automatically restart after an update. Defaults to `true`. |
| `Subprojects[].Dplists` | No | ASCII data point list files imported using the AsciiManager. |
| `Subprojects[].UpdateScripts` | No | Control scripts execute during a git pull (triggered by the `Update` button), but only when the package is updated to a higher version. |
| `Subprojects[].UninstallScripts` | No | Control scripts executed when the add-on is removed. |

### Example

```json
{
  "RepoName": "NTCIP",
  "Keywords": [
    "NTCIP"
  ],
  "Version": "1.0.0",
  "Description": "NTCIP",
  "OaVersions": "^3.20.0",
  "Subprojects": [
    {
      "Name": "NTCIPGateway_3.21",
      "Description": "NTCIP",
      "Managers": [
        {
          "Name": "WCCOAntcipgw",
          "StartMode": "always",
          "RestartOnUpdate": true
        }
      ],
      "Dplists": [
        "NTCIPGateway.dpl"
      ]
    }
  ]
}
```

### Notes

- `RepoName`, `Version`, `Description`, and `OaVersion` are mandatory for every add-on.
- All dependency repositories must also provide a valid `package.winccoa.json`.
- Dependencies are installed recursively before the parent add-on.
- Repositories targeting an incompatible `OaVersion` are not shown in the Extensions UI.
- Omitting optional arrays (`Keywords`, `Dependencies`, `Subprojects`, `Dplists`, etc.) is equivalent to providing empty arrays.
## Features

- Browse add-ons (from npm/GitHub registry)
- Install add-on into project (download, verify, place into subproject folder, trigger import if needed)
- Update add-on (version compare, changelog, safe restart if required)
- Remove add-on (cleanup)
