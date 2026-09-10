"""Fixed AO-04 service demonstration console.

The browser only controls one named service. Run/session/lease identities stay
inside OpenRush and the controller; this page never asks the operator to pick
one or schedule a future run.
"""

from __future__ import annotations

import argparse
import json
import secrets
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from flask import Flask, jsonify, render_template, request

HERE = Path(__file__).resolve().parent
FAULTS = {"exit", "timeout", "artifact_missing"}
SERVICE_ID = "ao04-demo-local"


class DemoControl:
    def __init__(self, call, clock=time.time):
        self.call = call
        self.clock = clock
        self.lock = threading.RLock()

    def checked(self, method: str, route: str, body=None):
        code, value = self.call(method, route, body)
        if code >= 400:
            raise ValueError(f"控制服务 HTTP {code}：{value.get('error', '操作失败')}")
        return value

    def state(self):
        return self.checked("GET", "/demo/services/ao04-demo-local")

    def detail(self):
        state = self.state()
        code, value = self.call("GET", "/experiments/ao04-demo-local/events")
        if code == 404:
            return {"state": state, "events": []}
        if code >= 400:
            raise ValueError(f"控制服务 HTTP {code}：无法读取事件")
        return {"state": state, "events": value.get("events", [])}

    def action(self, action: str, body=None):
        if action == "fault":
            kind = (body or {}).get("kind", "exit")
            if kind not in FAULTS:
                raise ValueError("仅支持进程退出、持续超时和缺失产物。")
            return self.checked("POST", "/demo/services/ao04-demo-local/fault", {"kind": kind})
        if action == "policy":
            mode = (body or {}).get("mode", "auto")
            if mode not in {"auto", "alert_only"}:
                raise ValueError("仅支持自动处置或仅告警策略。")
            return self.checked("POST", "/demo/services/ao04-demo-local/policy", {"mode": mode})
        if action not in {"start", "reset", "stop"}:
            raise ValueError("未知操作")
        return self.checked("POST", f"/demo/services/ao04-demo-local/{action}", body or {})


def create_app(lab: DemoControl):
    app = Flask(__name__, template_folder=str(HERE))
    app.config["DEMO_NONCE"] = secrets.token_urlsafe(32)
    app.config["TEMPLATES_AUTO_RELOAD"] = True

    @app.before_request
    def check_local():
        if request.host.split(":")[0] not in {"127.0.0.1", "localhost"}:
            return jsonify(error="仅允许本机访问"), 403
        if request.method == "POST":
            if request.headers.get("Origin") != request.host_url.rstrip("/"):
                return jsonify(error="拒绝跨站操作"), 403
            if request.headers.get("X-Demo-Nonce") != app.config["DEMO_NONCE"]:
                return jsonify(error="请刷新控制页后重试"), 403

    @app.after_request
    def no_cache(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.errorhandler(ValueError)
    def bad_request(exc):
        return jsonify(error=str(exc)), 409

    @app.get("/")
    def index():
        return render_template("index.html", nonce=app.config["DEMO_NONCE"])

    @app.get("/api/state")
    def state():
        return jsonify(lab.state())

    @app.get("/api/detail")
    def detail():
        return jsonify(lab.detail())

    @app.post("/api/action")
    def action():
        body = request.get_json(silent=True) or {}
        return jsonify(lab.action(str(body.get("action") or ""), body))

    return app


def configured_lab(config_path: Path) -> DemoControl:
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    output = Path(cfg["output"])
    private = json.loads((output / "private-control.json").read_text(encoding="utf-8"))
    base = f"http://127.0.0.1:{cfg['ports']['controller']}"
    token = private["token"]
    http = build_opener(ProxyHandler({}))

    def call(method: str, route: str, body=None):
        headers = {"X-AO04-Token": token, "Content-Type": "application/json"}
        req = Request(
            base + route,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
        )
        try:
            with http.open(req, timeout=210 if route.endswith("/read_status") else 12) as resp:
                return resp.status, json.load(resp)
        except HTTPError as exc:
            return exc.code, json.loads(exc.read())
        except (URLError, TimeoutError, OSError) as exc:
            raise ValueError("AO-04 控制服务未连接或响应超时。") from exc

    return DemoControl(call)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument(
        "--config", type=Path, default=HERE.parent / "m3-fastlane" / "web-e2e-current.json"
    )
    args = parser.parse_args()
    create_app(configured_lab(args.config)).run(
        host="127.0.0.1", port=args.port, threaded=True, use_reloader=False
    )


if __name__ == "__main__":
    main()
