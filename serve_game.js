const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const host = '0.0.0.0';
const browserHost = '127.0.0.1';
const port = 8765;
const root = __dirname;
const game = 'gta_vice_city_destroy_and_kill_v31.html';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream'
};
const allowedHosts = [
  /(^|\.)arcgis\.com$/i,
  /(^|\.)arcgisonline\.com$/i,
  /(^|\.)esri\.com$/i,
  /(^|\.)iprpraha\.cz$/i,
  /(^|\.)praha\.eu$/i
];

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Range,Accept,Authorization,X-Requested-With',
    'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges,ETag,Last-Modified',
    ...extra
  };
}

function parseProxyTarget(rawUrl) {
  const qIndex = rawUrl.indexOf('?');
  const pathname = decodeURIComponent((qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl));
  const rawQuery = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '';
  if (pathname.startsWith('/arcgis-proxy/')) {
    const tail = pathname.slice('/arcgis-proxy/'.length);
    if (/^https?:/i.test(tail)) return tail + (rawQuery ? '?' + rawQuery : '');
  }
  if (rawQuery.startsWith('url=')) return decodeURIComponent(rawQuery.slice(4));
  if (/^https?%3A/i.test(rawQuery)) return decodeURIComponent(rawQuery);
  if (/^https?:/i.test(rawQuery)) return rawQuery;
  try {
    const params = new URLSearchParams(rawQuery);
    const target = params.get('url');
    if (target) return target;
  } catch (_) {}
  return '';
}

function isAllowedTarget(target) {
  try {
    const url = new URL(target);
    return (url.protocol === 'https:' || url.protocol === 'http:') && allowedHosts.some(re => re.test(url.hostname));
  } catch (_) {
    return false;
  }
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('Proxy request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function proxyRequest(target, req, res, body, redirects = 0) {
  if (redirects > 5) {
    res.writeHead(502, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Too many upstream redirects');
    return;
  }
  const url = new URL(target);
  const transport = url.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': req.headers['user-agent'] || 'PragueGameLocalProxy/31',
    'Accept': req.headers.accept || '*/*',
    'Accept-Encoding': req.headers['accept-encoding'] || 'identity'
  };
  for (const name of ['content-type', 'range', 'if-none-match', 'if-modified-since']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  if (body.length) headers['Content-Length'] = String(body.length);

  const upstream = transport.request(url, {
    method: req.method,
    headers,
    timeout: 120000
  }, upstreamRes => {
    const status = upstreamRes.statusCode || 502;
    if ([301, 302, 303, 307, 308].includes(status) && upstreamRes.headers.location) {
      upstreamRes.resume();
      const next = new URL(upstreamRes.headers.location, url).toString();
      proxyRequest(next, req, res, status === 303 ? Buffer.alloc(0) : body, redirects + 1);
      return;
    }
    const pass = {};
    for (const name of ['content-type', 'content-length', 'content-encoding', 'cache-control', 'etag', 'last-modified', 'accept-ranges', 'content-range']) {
      if (upstreamRes.headers[name] !== undefined) pass[name] = upstreamRes.headers[name];
    }
    if (!pass['cache-control']) pass['cache-control'] = 'public, max-age=3600';
    res.writeHead(status, corsHeaders(pass));
    if (req.method === 'HEAD') {
      upstreamRes.resume();
      res.end();
    } else {
      upstreamRes.pipe(res);
    }
  });
  upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error', err => {
    console.error('[proxy error]', target, err.message);
    if (!res.headersSent) res.writeHead(502, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
    if (!res.writableEnded) res.end(JSON.stringify({ error: { message: err.message, target } }));
  });
  if (body.length && req.method !== 'GET' && req.method !== 'HEAD') upstream.write(body);
  upstream.end();
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = requestPath === '/' ? game : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  const rootPath = path.resolve(root);
  if (!filePath.startsWith(rootPath + path.sep) && filePath !== path.resolve(root, game)) {
    res.writeHead(403, corsHeaders()); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) { res.writeHead(404, corsHeaders()); res.end('Not found'); return; }
    res.writeHead(200, corsHeaders({
      'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store'
    }));
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders()); res.end(); return;
    }
    if ((req.url || '').startsWith('/proxy-health')) {
      res.writeHead(200, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
      res.end(JSON.stringify({ ok: true, version: 31, proxy: true }));
      return;
    }
    if ((req.url || '').startsWith('/arcgis-proxy')) {
      const target = parseProxyTarget(req.url || '');
      if (!isAllowedTarget(target)) {
        res.writeHead(400, corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
        res.end(JSON.stringify({ error: { message: 'Missing or disallowed proxy target', target } }));
        return;
      }
      const body = await collectBody(req);
      console.log('[proxy]', req.method, target);
      proxyRequest(target, req, res, body);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, corsHeaders()); res.end('Method not allowed'); return;
    }
    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    if (!res.writableEnded) res.end(err.message || 'Server error');
  }
});

server.listen(port, host, () => {
  const url = `http://${browserHost}:${port}/${game}`;
  console.log(`DESTROY AND KILL v31 running at ${url}`);
  console.log('This launcher includes the Prague ArcGIS/IPR CORS proxy.');
  console.log('For a phone on the same Wi-Fi, open http://YOUR-PC-IP:'+String(port)+'/'+game);
  console.log('When Prague loads, proxy requests will appear in this window.');
  console.log('Keep this window open. Press Ctrl+C to stop.');
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => {});
});
