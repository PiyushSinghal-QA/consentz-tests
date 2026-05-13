#!/usr/bin/env node
/**
 * tools/serve-dashboard.js
 *
 * Tiny static server for local dashboard previewing. We can't open
 * dashboard/index.html directly via file:// — Chrome blocks fetch() on
 * local files. This serves the dashboard/ folder over http://localhost:8765.
 *
 * Run:  node tools/serve-dashboard.js     (or `npm run dashboard:serve` from Automation/)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', 'dashboard');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 8765;

// Refresh data first
try {
  execSync(`node "${path.join(__dirname, 'build-dashboard-data.js')}"`, { stdio: 'inherit' });
} catch (e) {
  console.warn('[serve] Data build failed:', e.message);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // The dashboard's failure cards reference ../Automation/test-results/.../*.png
  // Allow safe access to those by resolving relative to PROJECT_ROOT for
  // paths starting with /Automation or ../Automation.
  let filePath;
  if (urlPath.startsWith('/Automation/') || urlPath.startsWith('/../Automation/')) {
    filePath = path.join(PROJECT_ROOT, urlPath.replace(/^\/(\.\.\/)?/, ''));
  } else {
    filePath = path.join(ROOT, urlPath);
  }

  // Defence-in-depth: prevent escaping the project root via ..
  if (!filePath.startsWith(PROJECT_ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, body) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`Not found: ${urlPath}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Dashboard ready: \x1b[36mhttp://localhost:${PORT}\x1b[0m\n`);
  console.log(`  Source: ${ROOT}`);
  console.log(`  Stop with Ctrl+C\n`);
});
