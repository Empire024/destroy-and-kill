#!/usr/bin/env python3
"""DESTROY AND KILL - local game server (Python fallback for machines without Node).

Plain static file server. There is deliberately NO proxy: every asset the game
uses is packaged locally, so the game has no remote runtime dependency.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
import sys
import threading
import webbrowser

HOST = '0.0.0.0'
PORT = int(os.environ.get('PORT', '8765'))
ROOT = Path(__file__).resolve().parent
GAME_CANDIDATES = ['index.html', 'gta_vice_city_destroy_and_kill_v31.html']

EXTRA_TYPES = {
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.wasm': 'application/wasm',
    '.ktx2': 'image/ktx2',
    '.mjs': 'text/javascript',
    '.md': 'text/plain',
}


def game_file():
    for name in GAME_CANDIDATES:
        if (ROOT / name).is_file():
            return name
    return GAME_CANDIDATES[0]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path in ('/', ''):
            self.path = '/' + game_file()
        return super().do_GET()

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return super().guess_type(path)

    def end_headers(self):
        # always fresh, so an updated build never serves a stale cached world
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # keep the console readable


def main():
    url = 'http://127.0.0.1:%d/' % PORT
    try:
        httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        print('Could not listen on port %d: %s' % (PORT, exc))
        print('The game may already be running - try opening %s' % url)
        return 1

    print('DESTROY AND KILL running at %s' % url)
    print('Phone on the same Wi-Fi: http://YOUR-PC-IP:%d/' % PORT)
    print('Keep this window open. Press Ctrl+C to stop.')
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
