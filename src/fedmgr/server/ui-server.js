const express = require('express');
const fs = require('fs');
const path = require('path');

/**
 * UI Server Module
 * Handles static file serving and fallback HTML generation
 */
class UIServer {
  constructor(config) {
    this.publicDir = config.publicDir;
    this.fedName = config.fedName;
    this.clientId = config.clientId;
    this.port = config.port;
  }

  /**
   * Configure static file serving
   */
  configureStaticFiles(app) {
    console.log(`📁 Serving static files from: ${this.publicDir}`);
    
    if (fs.existsSync(this.publicDir)) {
      app.use(express.static(this.publicDir));
      console.log(`✅ Static files directory found and configured`);
    } else {
      console.log(`⚠️ Static files directory not found: ${this.publicDir}`);
    }
  }

  /**
   * Generate fallback HTML when index.html is not found
   */
  generateFallbackHTML(indexPath) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Federation Demo - Fallback</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #f8f9fa; }
          .container { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin: 20px 0; }
          button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin: 5px; }
          button:hover { background: #005a8b; }
          .token { background: #e8f4f8; padding: 10px; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 12px; }
          .success { color: #28a745; }
          .error { color: #dc3545; }
        </style>
      </head>
      <body>
        <div class="warning">
          <strong>⚠️ Notice:</strong> Using fallback HTML. The main index.html file was not found at: <code>${indexPath}</code>
        </div>
        
        <h1>🛰️ Federation Demo (Fallback)</h1>
        
        <div class="container">
          <h2>Authentication</h2>
          <p><strong>Status:</strong> Federation "${this.fedName}" is active</p>
          <p><strong>OAuth:</strong> ${this.clientId ? 'Enabled' : 'Disabled'}</p>
          <button onclick="window.location.href='/login'">Login with GitHub</button>
          <div id="auth-info" style="margin-top: 15px;"></div>
        </div>
        
        <div class="container">
          <h2>API Endpoints</h2>
          <ul>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/.well-known/openid-federation">Federation Metadata</a></li>
          </ul>
          <button onclick="testMcp()">Test MCP Server</button>
          <div id="test-results"></div>
        </div>

        <div class="container" id="admin-panel" style="display: none;">
          <h2>🔐 Admin Panel</h2>
          <div style="background: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0;">
            <strong>Admin Access:</strong> You have administrative privileges
          </div>
          <button onclick="loadUsers()">Manage Users</button>
          <button onclick="loadConfig()">System Configuration</button>
          <button onclick="testAdminEndpoint()">Test Admin Access</button>
          <div id="admin-results"></div>
        </div>

        ${this.generateJavaScript()}
      </body>
      </html>
    `;
  }

  /**
   * Generate JavaScript for the fallback HTML
   */
  generateJavaScript() {
    return `
        <script>
          // Check for token in URL
          const urlParams = new URLSearchParams(window.location.search);
          const token = urlParams.get('token');
          const user = urlParams.get('user');
          let isAdmin = false;
          
          // Decode JWT to check admin status
          function parseJWT(token) {
            try {
              const base64Url = token.split('.')[1];
              const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
              const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
              }).join(''));
              return JSON.parse(jsonPayload);
            } catch (e) {
              return null;
            }
          }
          
          if (token && user) {
            const decoded = parseJWT(token);
            isAdmin = decoded && (decoded.admin === true || decoded.role === 'admin' || (decoded.roles && decoded.roles.includes('admin')));
            
            document.getElementById('auth-info').innerHTML = 
              '<div class="success">✅ Authenticated as: ' + user + (isAdmin ? ' (ADMIN)' : '') + '</div>' +
              '<div class="token">Token: ' + token.substring(0, 50) + '...</div>';
            
            // Show admin panel if user is admin
            if (isAdmin) {
              document.getElementById('admin-panel').style.display = 'block';
            }
            
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          
          async function testMcp() {
            if (!token) {
              alert('Please login first');
              return;
            }
            
            try {
              const response = await fetch('http://localhost:4001/api', {
                headers: { 'Authorization': 'Bearer ' + token }
              });
              const data = await response.json();
              document.getElementById('test-results').innerHTML = 
                '<h3 class="success">✅ MCP Test Result:</h3><pre>' + JSON.stringify(data, null, 2) + '</pre>';
            } catch (error) {
              document.getElementById('test-results').innerHTML = 
                '<h3 class="error">❌ MCP Test Failed:</h3><p>' + error.message + '</p>';
            }
          }
          
          // Admin functions
          async function loadUsers() {
            if (!token) {
              alert('Please login first');
              return;
            }
            
            try {
              const response = await fetch('/api/admin/users', {
                headers: { 'Authorization': 'Bearer ' + token }
              });
              const data = await response.json();
              
              if (response.ok) {
                let html = '<h3 class="success">👥 User Management</h3>';
                html += '<p><strong>Total Users:</strong> ' + data.total + '</p>';
                html += '<p><strong>Admin Users:</strong> ' + data.admin_users.join(', ') + '</p>';
                html += '<table style="width: 100%; border-collapse: collapse; margin-top: 10px;">';
                html += '<tr style="background: #f8f9fa;"><th>Login</th><th>GitHub ID</th><th>Created</th><th>Admin</th></tr>';
                
                data.users.forEach(user => {
                  html += '<tr>';
                  html += '<td style="padding: 8px; border: 1px solid #ddd;">' + user.login + '</td>';
                  html += '<td style="padding: 8px; border: 1px solid #ddd;">' + user.github_id + '</td>';
                  html += '<td style="padding: 8px; border: 1px solid #ddd;">' + new Date(user.created_at).toLocaleDateString() + '</td>';
                  html += '<td style="padding: 8px; border: 1px solid #ddd;">' + (user.admin ? '✅' : '❌') + '</td>';
                  html += '</tr>';
                });
                
                html += '</table>';
                document.getElementById('admin-results').innerHTML = html;
              } else {
                document.getElementById('admin-results').innerHTML = 
                  '<h3 class="error">❌ Access Denied:</h3><p>' + (data.message || 'Failed to load users') + '</p>';
              }
            } catch (error) {
              document.getElementById('admin-results').innerHTML = 
                '<h3 class="error">❌ Error:</h3><p>' + error.message + '</p>';
            }
          }
          
          async function loadConfig() {
            if (!token) {
              alert('Please login first');
              return;
            }
            
            try {
              const response = await fetch('/api/admin/config', {
                headers: { 'Authorization': 'Bearer ' + token }
              });
              const data = await response.json();
              
              if (response.ok) {
                document.getElementById('admin-results').innerHTML = 
                  '<h3 class="success">⚙️ System Configuration</h3>' +
                  '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
              } else {
                document.getElementById('admin-results').innerHTML = 
                  '<h3 class="error">❌ Access Denied:</h3><p>' + (data.message || 'Failed to load config') + '</p>';
              }
            } catch (error) {
              document.getElementById('admin-results').innerHTML = 
                '<h3 class="error">❌ Error:</h3><p>' + error.message + '</p>';
            }
          }
          
          async function testAdminEndpoint() {
            if (!token) {
              alert('Please login first');
              return;
            }
            
            try {
              const response = await fetch('/federation_list', {
                headers: { 'Authorization': 'Bearer ' + token }
              });
              const data = await response.json();
              
              if (response.ok) {
                document.getElementById('admin-results').innerHTML = 
                  '<h3 class="success">✅ Admin Access Test:</h3>' +
                  '<p>Successfully accessed admin endpoint</p>' +
                  '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
              } else {
                document.getElementById('admin-results').innerHTML = 
                  '<h3 class="error">❌ Admin Access Test Failed:</h3><p>' + (data.message || 'Access denied') + '</p>';
              }
            } catch (error) {
              document.getElementById('admin-results').innerHTML = 
                '<h3 class="error">❌ Error:</h3><p>' + error.message + '</p>';
            }
          }
        </script>
    `;
  }

  /**
   * Register UI routes
   */
  registerRoutes(app) {
    // Configure static file serving
    this.configureStaticFiles(app);

    // Root route with fallback HTML
    app.get('/', (req, res) => {
      const indexPath = path.join(this.publicDir, 'index.html');
      
      console.log(`🔍 Looking for index.html at: ${indexPath}`);
      
      if (fs.existsSync(indexPath)) {
        console.log(`✅ Found index.html, serving file`);
        res.sendFile(indexPath);
      } else {
        console.log(`❌ index.html not found, serving fallback HTML`);
        res.send(this.generateFallbackHTML(indexPath));
      }
    });
  }

  /**
   * Get UI server status
   */
  getStatus() {
    return {
      public_directory: this.publicDir,
      static_files_available: fs.existsSync(this.publicDir),
      index_html_exists: fs.existsSync(path.join(this.publicDir, 'index.html')),
      federation: this.fedName,
      oauth_enabled: !!this.clientId
    };
  }
}

/**
 * Factory function to create UI server
 */
function createUIServer(config) {
  return new UIServer(config);
}

module.exports = {
  UIServer,
  createUIServer
};