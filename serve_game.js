// DESTROY AND KILL — local game server.
//
// Plain static file server. There is deliberately NO proxy: every asset the
// game uses (Three.js, world data, models, textures) is packaged locally, so
// the game has no remote runtime dependency and nothing needs CORS help.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const host = '0.0.0.0';
const browserHost = '127.0.0.1';
const port = Number(process.env.PORT) || 8765;
const root = __dirname;
// The build is being renamed to index.html; keep resolving the old versioned
// filename until the rename lands so existing bookmarks keep working.
const GAME_CANDIDATES = ['index.html', 'gta_vice_city_destroy_and_kill_v31.html'];
const game = GAME_CANDIDATES.find(f => fs.existsSync(path.join(__dirname, f))) || GAME_CANDIDATES[0];

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function serveStatic(req, res) {
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = requestPath === '/' ? game : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  const rootPath = path.resolve(root);

  // never serve outside the package directory
  if (filePath !== rootPath && !filePath.startsWith(rootPath + path.sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      // gameplay assets are versioned by the package itself; keep it simple and
      // always fresh so an updated build never serves a stale cached world
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method not allowed'); return;
  }
  serveStatic(req, res);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use — the game may already be running.`);
    console.error(`Open http://${browserHost}:${port}/ or close the other window.`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  const url = `http://${browserHost}:${port}/`;
  console.log(`DESTROY AND KILL running at ${url}`);
  console.log(`Phone on the same Wi-Fi: http://YOUR-PC-IP:${port}/`);
  console.log('Keep this window open. Press Ctrl+C to stop.');
  const command = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => {});
});
