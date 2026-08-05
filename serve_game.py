from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs, unquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from pathlib import Path
import json
import os
import re
import sys
import threading
import webbrowser

HOST = '0.0.0.0'
PORT = 8765
ROOT = Path(__file__).resolve().parent
GAME = 'gta_vice_city_destroy_and_kill_v31.html'
ALLOWED = [
    re.compile(r'(^|\.)arcgis\.com$', re.I),
    re.compile(r'(^|\.)arcgisonline\.com$', re.I),
    re.compile(r'(^|\.)esri\.com$', re.I),
    re.compile(r'(^|\.)iprpraha\.cz$', re.I),
    re.compile(r'(^|\.)praha\.eu$', re.I),
]

class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def translate_path(self, path):
        clean = urlsplit(path).path
        if clean == '/':
            clean = '/' + GAME
        return str(ROOT / clean.lstrip('/'))

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type,Range,Accept,Authorization,X-Requested-With')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges,ETag,Last-Modified')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_HEAD(self):
        if self.path.startswith('/proxy-health'):
            self._health(head=True)
        elif self.path.startswith('/arcgis-proxy'):
            self._proxy(head=True)
        else:
            super().do_HEAD()

    def do_GET(self):
        if self.path.startswith('/proxy-health'):
            self._health()
        elif self.path.startswith('/arcgis-proxy'):
            self._proxy()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/arcgis-proxy'):
            self._proxy()
        else:
            self.send_error(405, 'Method not allowed')

    def _health(self, head=False):
        body = json.dumps({'ok': True, 'version': 30, 'proxy': True}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _target(self):
        parts = urlsplit(self.path)
        if parts.path.startswith('/arcgis-proxy/'):
            tail = unquote(parts.path[len('/arcgis-proxy/'):])
            if tail.startswith(('http://', 'https://')):
                return tail + (('?' + parts.query) if parts.query else '')
        raw = parts.query
        if raw.startswith('url='):
            return unquote(raw[4:])
        if raw.lower().startswith(('http%3a', 'https%3a')):
            return unquote(raw)
        if raw.startswith(('http://', 'https://')):
            return raw
        return parse_qs(raw).get('url', [''])[0]

    def _allowed(self, target):
        try:
            u = urlsplit(target)
            return u.scheme in ('http', 'https') and any(rx.search(u.hostname or '') for rx in ALLOWED)
        except Exception:
            return False

    def _proxy(self, head=False):
        target = self._target()
        if not self._allowed(target):
            self._json_error(400, 'Missing or disallowed proxy target', target)
            return
        length = int(self.headers.get('Content-Length') or 0)
        if length > 8 * 1024 * 1024:
            self._json_error(413, 'Proxy request body too large', target)
            return
        body = self.rfile.read(length) if length else None
        headers = {
            'User-Agent': self.headers.get('User-Agent', 'PragueGameLocalProxy/31'),
            'Accept': self.headers.get('Accept', '*/*'),
            'Accept-Encoding': self.headers.get('Accept-Encoding', 'identity'),
        }
        for name in ('Content-Type', 'Range', 'If-None-Match', 'If-Modified-Since'):
            if self.headers.get(name):
                headers[name] = self.headers[name]
        print('[proxy]', self.command, target, flush=True)
        try:
            req = Request(target, data=body, headers=headers, method='HEAD' if head else self.command)
            with urlopen(req, timeout=120) as upstream:
                payload = b'' if head else upstream.read()
                self.send_response(upstream.status)
                for name in ('Content-Type', 'Content-Encoding', 'Cache-Control', 'ETag', 'Last-Modified', 'Accept-Ranges', 'Content-Range'):
                    value = upstream.headers.get(name)
                    if value:
                        self.send_header(name, value)
                self.send_header('Content-Length', str(len(payload) if not head else int(upstream.headers.get('Content-Length') or 0)))
                self.end_headers()
                if not head:
                    self.wfile.write(payload)
        except HTTPError as err:
            payload = err.read()
            self.send_response(err.code)
            self.send_header('Content-Type', err.headers.get('Content-Type', 'application/octet-stream'))
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            if not head:
                self.wfile.write(payload)
        except Exception as err:
            print('[proxy error]', target, err, flush=True)
            self._json_error(502, str(err), target)

    def _json_error(self, status, message, target=''):
        payload = json.dumps({'error': {'message': message, 'target': target}}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        if '/arcgis-proxy' not in self.path:
            super().log_message(fmt, *args)

os.chdir(ROOT)
server = ThreadingHTTPServer((HOST, PORT), Handler)
url = f'http://127.0.0.1:{PORT}/{GAME}'
print(f'DESTROY AND KILL v31 running at {url}', flush=True)
print('This launcher includes the Prague ArcGIS/IPR CORS proxy.', flush=True)
print('When Prague loads, proxy requests will appear in this window.', flush=True)
print('Keep this window open. Press Ctrl+C to stop.', flush=True)
threading.Timer(0.7, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
