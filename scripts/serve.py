#!/usr/bin/env python3
import argparse
import functools
import json
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def create_server():
    root = Path(__file__).resolve().parent.parent
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(root))
    return ThreadingHTTPServer(("127.0.0.1", 0), handler)


def main():
    parser = argparse.ArgumentParser(description="Run QR AirGap Transfer on a loopback-only web server.")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    server = create_server()
    host, port = server.server_address
    if args.self_test:
        print(json.dumps({"host": host, "port": port, "bound": True}))
        server.server_close()
        return
    url = f"http://{host}:{port}/index.html"
    print(f"QR AirGap Transfer: {url}")
    print("Press Ctrl+C to stop.")
    threading.Timer(0.15, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
