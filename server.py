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
DATA_DIR = os.environ.get("DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(DATA_DIR, "app_data.json")

def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print("Error reading data file:", e)
    return None

def save_data(data):
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print("Error saving data file:", e)
        return False

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

    # Initialize data file with empty companies & default admin if not existing
    if not os.path.exists(DATA_FILE):
        default_state = {
            "companies": [],
            "users": [
                {
                    "id": "admin",
                    "username": "admin",
                    "full_name": "ผู้ดูแลระบบ (Administrator)",
                    "email": "admin",
                    "password": "admin123",
                    "role": "super_admin",
                    "company_id": None,
                    "title": "ผู้ดูแลระบบศูนย์รวมลิงก์ (System Administrator)",
                    "avatar": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
                }
            ]
        }
        save_data(default_state)

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
