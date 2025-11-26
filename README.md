# WinCC OA Add-on Marketplace

A modular marketplace for SIMATIC WinCC OA to discover, install, update, and remove add-ons directly in your project.

- The Add-on Handler is implemented as a WinCC OA JavaScript Manager using the `winccoa-manager` Node.js package. This allows your service to access dp values/events and project services while leveraging the npm ecosystem for marketplace functionality.
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
- Optional: GitHub token if accessing private repositories through the GitHub REST API

## Setup

1. Install Marketplace Add-on
   - Download or clone from GitHub: https://github.com/winccoa/winccoa-marketplace
   - Install npm packages: run `npm install` and afterwards `npm run compile`.
   - Register in WinCC OA Project Administration.

2. Add sub-project to your project
   - Add to your project as sub-project via Project Administration or Console UI.
   - In the Console, add a JavaScript Manager with the script parameter pointing to your Node.js entry file `winccoa-marketplace/index.js`.
   - In the Console, add a Web Server (if not already existing).

3. Configure HTTP Server endpoints
   - Locate `scripts\libs\classes\HttpServer.ctl` (either from the WinCC OA installation directory or in your project directory).
   - Add the following `#uses` statement at the top of the file after all other #uses statements:
     ```
     #uses "classes/marketplace/MarketplaceEndpoints"
     ```
   - Add the Marketplace endpoint connection after other endpoint connections (such as `RptHttpEndpoints::connectEndpoints(httpsPort);` or `OidcHttpEndpoints::connectEndpoints(allowAll);`):
     ```
     // connect endpoints for Marketplace
     MarketplaceEndpoints::connectEndpoints(httpsPort);
     ```

4. Scaffold the Node.js module
   - In the WinCC OA `javascript` folder, create a module directory (e.g. `marketplace/`), initialize npm, and add `winccoa-manager` as a dependency.
   - Implement the service endpoints that the UI will call (vRPC handlers or REST hooks via HTTP Server).

5. Open the Web UI
   - Go to URL: https://localhost/data/marketplace/index.html

## Features

- Browse add-ons (from npm/GitHub registry)
- Install add-on into project (download, verify, place into subproject folder, trigger import if needed)
- Update add-on (version compare, changelog, safe restart if required)
- Remove add-on (cleanup)
