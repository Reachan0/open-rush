import unittest

from server import DemoControl, create_app


class FakeControl:
    def __init__(self):
        self.calls = []
        self.state_payload = {
            "serviceId": "ao04-demo-local",
            "processState": "stopped",
            "businessState": "unknown",
            "protectionState": "idle",
        }
        self.events_payload = []

    def __call__(self, method, route, body=None):
        self.calls.append((method, route, body))
        if method == "GET" and route == "/demo/services/ao04-demo-local":
            return 200, self.state_payload
        if method == "GET" and route == "/experiments/ao04-demo-local/events":
            return 200, {"events": self.events_payload}
        if method == "POST" and route == "/demo/services/ao04-demo-local/policy":
            self.state_payload["mode"] = body["mode"]
            return 200, {"mode": body["mode"]}
        if method == "POST" and route.startswith("/demo/services/ao04-demo-local/"):
            action = route.rsplit("/", 1)[-1]
            return 200, {"status": action}
        return 404, {"error": "not found"}


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeControl()
        self.lab = DemoControl(self.fake, clock=lambda: 100)

    def test_state_uses_fixed_service_without_session_or_run(self):
        self.assertEqual(self.lab.state()["serviceId"], "ao04-demo-local")
        self.assertEqual(self.fake.calls, [("GET", "/demo/services/ao04-demo-local", None)])

    def test_detail_reads_fixed_service_events(self):
        self.fake.events_payload = [{"type": "fault.applied"}]
        detail = self.lab.detail()
        self.assertEqual(detail["state"]["serviceId"], "ao04-demo-local")
        self.assertEqual(detail["events"], self.fake.events_payload)

    def test_actions_use_fixed_service_routes(self):
        self.lab.action("start")
        self.lab.action("fault", {"kind": "exit"})
        self.lab.action("policy", {"mode": "alert_only"})
        self.lab.action("reset")
        self.assertEqual(
            [(method, route) for method, route, _ in self.fake.calls],
            [
                ("POST", "/demo/services/ao04-demo-local/start"),
                ("POST", "/demo/services/ao04-demo-local/fault"),
                ("POST", "/demo/services/ao04-demo-local/policy"),
                ("POST", "/demo/services/ao04-demo-local/reset"),
            ],
        )

    def test_rejects_unknown_fault_and_policy(self):
        with self.assertRaises(ValueError):
            self.lab.action("fault", {"kind": "kill:123"})
        with self.assertRaises(ValueError):
            self.lab.action("policy", {"mode": "anything"})
        self.assertEqual(self.fake.calls, [])

    def test_http_mutations_require_same_origin_and_nonce(self):
        app = create_app(self.lab)
        client = app.test_client()
        self.assertEqual(client.post("/api/action", json={"action": "start"}).status_code, 403)
        page = client.get("/")
        self.assertEqual(page.status_code, 200)
        html = page.get_data(as_text=True)
        self.assertIn("项目交付质量检查", html)
        self.assertIn("m3/project-delivery-input.json", html)
        self.assertIn("项目质量检查服务", html)
        self.assertIn("lastIndexOf('experiment.created')", html)
        self.assertIn("e.processGeneration===state.processGeneration", html)
        self.assertIn("AO-04 已完成恢复", html)
        self.assertIn("后置节点允许继续", html)
        self.assertIn("后置节点应停止", html)
        self.assertNotIn("后置节点已经继续执行", html)
        self.assertNotIn("后置节点已跳过", html)
        nonce = app.config["DEMO_NONCE"]
        headers = {"X-Demo-Nonce": nonce, "Origin": "http://evil.example"}
        self.assertEqual(client.post("/api/action", headers=headers, json={"action": "start"}).status_code, 403)
        headers["Origin"] = "http://localhost"
        response = client.post("/api/action", headers=headers, json={"action": "start"})
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
