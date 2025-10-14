# WinCC OA Marketplace Web Interface

A modern web interface for managing WinCC OA repositories and subprojects, built with Siemens IX Web Components.

## Features

- **Repository Browser**: Browse available repositories from GitHub organizations
- **VS Code-like Interface**: Familiar layout similar to VS Code's extensions view
- **Repository Details**: View detailed information, README files, and repository statistics
- **Repository Management**: Clone, pull, register, and unregister repositories
- **Real-time Status**: Visual indicators for cloned and registered repositories
- **Search & Filter**: Find repositories quickly with search functionality
- **Responsive Design**: Works on desktop and mobile devices

## Getting Started

### Prerequisites

- WinCC OA Marketplace server running (with the endpoints from `MarketplaceEndpoints.ctl`)
- Web server to serve the HTML files (or open directly in browser for local development)
- For HTTPS with self-signed certificates: Browser configuration to handle SSL certificate issues

### Installation

1. Ensure your WinCC OA Marketplace server is running on `https://localhost` (or update the base URL in `marketplace.js`)

2. Serve the web interface files:
   ```bash
   # Option 1: Using Python's built-in server
   cd web
   python -m http.server 8080
   
   # Option 2: Using Node.js http-server
   npx http-server web -p 8080
   
   # Option 3: Using any other web server
   ```

3. Open your browser and navigate to `http://localhost:8080`

### CORS-Enabled Development Server

For development with CORS support, use the included server:
```bash
python cors-server.py 8080
```

This server automatically:
- Serves the web interface files
- Enables CORS headers for cross-origin requests
- Provides better error logging

## Usage

### Browsing Repositories

1. **Repository List**: The left sidebar shows all available repositories from the selected organization
2. **Search**: Use the search box to filter repositories by name or description
3. **Organization Selection**: Choose different GitHub organizations from the dropdown

### Repository Actions

Click on any repository to view its details and access these actions:

- **Clone**: Download the repository to your local system
- **Pull**: Update an already cloned repository with latest changes
- **Register**: Register a cloned repository as a WinCC OA subproject
- **Unregister**: Remove a repository from registered subprojects

### Repository Information

The detail view provides:

- **Overview Tab**: Repository statistics, local status, and metadata
- **README Tab**: Rendered README content from the repository
- **Files Tab**: File browser (future enhancement)

### Status Indicators

- **Red dot**: Repository not cloned locally
- **Blue dot**: Repository cloned locally
- **Green dot**: Repository registered as subproject

## API Integration

The interface communicates with your WinCC OA Marketplace server using these endpoints:

- `GET /marketplace/listRepos?organization={org}` - List repositories
- `GET /marketplace/cloneRepo?url={url}&path={path}` - Clone repository
- `GET /marketplace/pullRepo?repo={repo}` - Pull repository updates
- `GET /marketplace/regSubProject?path={path}` - Register subproject
- `GET /marketplace/unregister?path={path}` - Unregister subproject
- `GET /marketplace/listProjects` - List registered projects

## Configuration

### Base URL

Update the base URL in `marketplace.js` if your server runs on a different address:

```javascript
constructor() {
    this.baseUrl = 'https://your-server-address'; // Change this line
    // ...
}
```

### Styling

The interface uses Siemens IX design system. You can customize colors and styling by modifying `styles.css` while maintaining IX design tokens.

## Browser Compatibility

- Modern browsers supporting ES6+ features
- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## Development

### File Structure

```
web/
├── index.html          # Main HTML structure
├── styles.css          # Custom CSS styles
├── marketplace.js      # JavaScript functionality
└── README.md          # This file
```

### Customization

1. **Styling**: Modify `styles.css` to adjust appearance
2. **Functionality**: Extend `marketplace.js` to add new features
3. **Layout**: Update `index.html` for structural changes

### Adding New Features

The `MarketplaceUI` class in `marketplace.js` provides a clean structure for adding new functionality:

```javascript
// Example: Add a new action
async myCustomAction() {
    try {
        const response = await fetch(`${this.baseUrl}/marketplace/myEndpoint`);
        // Handle response
        this.showSuccess('Action completed');
    } catch (error) {
        this.showError('Action failed: ' + error.message);
    }
}
```

## SSL Certificate Handling

The interface is configured to work with HTTPS backends, including those with self-signed certificates. However, due to browser security restrictions, JavaScript cannot ignore SSL certificate errors directly.

### For Development with Self-Signed Certificates:

**Option 1: Accept Certificate Manually**
1. Navigate directly to your HTTPS backend URL (e.g., `https://localhost`)
2. Accept the security warning and add the certificate exception
3. Return to the web interface - it should now work

**Option 2: Launch Browser with SSL Flags (Development Only)**
```bash
# Chrome/Edge
chrome.exe --ignore-certificate-errors --ignore-ssl-errors --disable-web-security --user-data-dir=/tmp/chrome-dev

# Firefox
firefox.exe -profile /tmp/firefox-dev
```

**Option 3: Use HTTP for Local Development**
Change the baseUrl in `marketplace.js` to use HTTP instead:
```javascript
this.baseUrl = "http://localhost"; // Use HTTP instead of HTTPS
```

**Option 4: Use Proper SSL Certificates**
Set up valid SSL certificates for your development environment using tools like mkcert.

## Troubleshooting

### Common Issues

1. **CORS Policy Errors** 
   - **Problem**: `Access to fetch ... has been blocked by CORS policy`
   - **Solutions**: 
     - Add CORS headers to your WinCC OA server
     - Use the included `cors-server.py` for development
     - Set backend URL to same origin in debug panel
     - Configure WinCC OA server to allow cross-origin requests

2. **SSL Certificate Errors**: See SSL Certificate Handling section above

3. **Connection Refused**
   - **Problem**: `net::ERR_CONNECTION_REFUSED` or `Failed to fetch`
   - **Solutions**:
     - Verify WinCC OA Marketplace server is running
     - Check if server is accessible at the configured URL
     - Use the debug panel (⚙️ button) to test different URLs
     - Try HTTP instead of HTTPS for local development

4. **API Endpoints Not Found**: Verify the marketplace server is running and endpoints are registered

5. **Mixed Content Warnings**: Avoid HTTPS frontend accessing HTTP backend (or vice versa)

### Debug Panel

Click the ⚙️ (settings) button in the top-right corner to access the debug panel, which provides:
- Current connection settings
- Quick URL configuration options
- Connection status information
- Troubleshooting guidance

### Debug Mode

Open browser developer tools (F12) to view console logs and network requests for debugging.

## Contributing

1. Follow the existing code style and structure
2. Test changes across different browsers
3. Update documentation for new features
4. Ensure responsive design is maintained

## License

This project follows the same license as the parent WinCC OA Marketplace project.