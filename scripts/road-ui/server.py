#!/usr/bin/env python3
"""Loopback-only JSON API for the Road Builder developer tool."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import road_ui


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def _route(self):
        return [unquote(part) for part in urlparse(self.path).path.split("/") if part]

    def do_GET(self):  # noqa: N802
        try:
            route = self._route()
            if route == ["api", "metadata"]:
                return self._send(200, road_ui.metadata())
            if route == ["api", "roads"]:
                return self._send(200, {"roads": road_ui.list_roads(road_ui.REGISTRY)})
            if len(route) == 3 and route[:2] == ["api", "roads"]:
                return self._send(200, {"road": road_ui.get_road(road_ui.REGISTRY, route[2])})
            self._send(404, {"error": {"message": "Not found"}})
        except Exception as error:  # local developer boundary
            self._send(400, {"error": {"type": type(error).__name__, "message": str(error)}})

    def do_POST(self):  # noqa: N802
        self._mutate("POST")

    def do_PUT(self):  # noqa: N802
        self._mutate("PUT")

    def _mutate(self, method):
        try:
            route, body = self._route(), self._body()
            if route == ["api", "osm", "inspect"]:
                result = road_ui.inspect_osm(body["road"])
            elif route == ["api", "n13", "analyze"]:
                result = road_ui.analyze_n13(body["road"])
            elif route == ["api", "n13", "prepare"]:
                result = road_ui.prepare_class(str(body["class"]))
            elif route == ["api", "match", "preview"]:
                result = road_ui.preview_match(body["road"])
            elif route == ["api", "roads"] and method == "POST":
                result = {"road": road_ui.save_road(road_ui.REGISTRY, body["road"])}
            elif len(route) == 3 and route[:2] == ["api", "roads"] and method == "PUT":
                result = {"road": road_ui.save_road(road_ui.REGISTRY, body["road"], route[2])}
            elif len(route) == 4 and route[:2] == ["api", "roads"] and route[3] == "build":
                result = road_ui.build_road(route[2])
            else:
                return self._send(404, {"error": {"message": "Not found"}})
            self._send(200, result)
        except Exception as error:  # structured errors at the local HTTP boundary
            self._send(400, {"error": {"type": type(error).__name__, "message": str(error)}})

    def log_message(self, format, *args):  # noqa: A002
        print(f"Road Builder API: {format % args}")


def run(host="127.0.0.1", port=8765):
    if host != "127.0.0.1":
        raise ValueError("Road Builder API must bind only to 127.0.0.1")
    print(f"Road Builder API listening at http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    run()
