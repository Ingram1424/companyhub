#!/usr/bin/env python3
"""
Production & Development Server for Multi-Company Hub (Railway Ready)
Serves static frontend assets & provides JSON API persistence for companies and users.
"""

import http.server
import socketserver
import os
import sys
import json

PORT = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 8000))

# Persistent directory: support Railway volumes (/data) or custom DATA_DIR
REPO_DIR = os.path.dirname(os.path.abspath(__file__))
if os.path.isdir("/data"):
    DATA_DIR = "/data"
elif os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") and os.path.isdir(os.environ["RAILWAY_VOLUME_MOUNT_PATH"]):
    DATA_DIR = os.environ["RAILWAY_VOLUME_MOUNT_PATH"]
elif os.environ.get("DATA_DIR") and os.path.isdir(os.environ.get("DATA_DIR")):
    DATA_DIR = os.environ.get("DATA_DIR")
else:
    DATA_DIR = REPO_DIR

DATA_FILE = os.path.join(DATA_DIR, "app_data.json")
BUNDLE_FILE = os.path.join(REPO_DIR, "app_data.json")

def load_data():
    # 1. Try active DATA_FILE
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                if d and (d.get("companies") or d.get("users")):
                    return d
        except Exception as e:
            print("Error reading DATA_FILE:", e)

    # 2. Try repo bundled app_data.json
    if os.path.exists(BUNDLE_FILE):
        try:
            with open(BUNDLE_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                if DATA_FILE != BUNDLE_FILE:
                    save_data(d)
                return d
        except Exception as e:
            print("Error reading BUNDLE_FILE:", e)

    return None

def save_data(data):
    saved = False
    try:
        os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        saved = True
    except Exception as e:
        print("Error saving to DATA_FILE:", e)

    if BUNDLE_FILE != DATA_FILE and os.path.exists(os.path.dirname(BUNDLE_FILE)):
        try:
            with open(BUNDLE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    return saved

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/data":
            data = load_data()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(data or {}).encode("utf-8"))
            return
        elif self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/save":
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                payload = json.loads(post_data.decode("utf-8"))
                success = save_data(payload)
                self.send_response(200 if success else 500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": success}).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return
        super().do_POST()

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(current_dir)

    # Initialize data file from bundled data if active DATA_FILE does not exist
    if not os.path.exists(DATA_FILE):
        existing = load_data()
        if existing:
            save_data(existing)

    handler = CustomHTTPRequestHandler
    # Bind to 0.0.0.0 for Railway / Docker
    with socketserver.TCPServer(("0.0.0.0", PORT), handler) as httpd:
        print("=" * 60)
        print("🚀 Multi-Company Hub Server (Railway Ready)")
        print(f"📡 Server running at: http://0.0.0.0:{PORT}")
        print("=" * 60)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
