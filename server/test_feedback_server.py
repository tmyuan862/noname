import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import feedback_server as api


class FeedbackApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        api.DATA_DIR = Path(self.temp_dir.name)
        api.DATA_FILE = api.DATA_DIR / "feedback.jsonl"
        api.request_times.clear()
        self.server = api.ThreadingHTTPServer(("127.0.0.1", 0), api.FeedbackHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def post(self, payload, content_type="application/json"):
        body = json.dumps(payload).encode()
        request = urllib.request.Request(
            self.base_url + "/feedback",
            data=body,
            headers={"Content-Type": content_type},
            method="POST",
        )
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())
        return response.status, json.loads(response.read())

    def request(self, path, method="GET", payload=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            headers={"Content-Type": "application/json"} if body else {},
            method=method,
        )
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())
        return response.status, json.loads(response.read())

    def test_valid_feedback_is_saved(self):
        status, response = self.post({"category": "建议", "message": "希望增加校园打印店的位置。", "website": ""})
        self.assertEqual(status, 201)
        self.assertTrue(response["ok"])
        record = json.loads(api.DATA_FILE.read_text(encoding="utf-8"))
        self.assertEqual(record["category"], "建议")
        self.assertEqual(record["message"], "希望增加校园打印店的位置。")
        self.assertNotIn("ip", record)

    def test_invalid_category_is_rejected(self):
        status, _ = self.post({"category": "管理员", "message": "这是一条足够长的反馈", "website": ""})
        self.assertEqual(status, 422)
        self.assertFalse(api.DATA_FILE.exists())

    def test_short_message_is_rejected(self):
        status, _ = self.post({"category": "问题", "message": "短", "website": ""})
        self.assertEqual(status, 422)

    def test_honeypot_is_accepted_but_not_saved(self):
        status, _ = self.post({"category": "建议", "message": "机器人提交的垃圾内容", "website": "spam"})
        self.assertEqual(status, 201)
        self.assertFalse(api.DATA_FILE.exists())

    def test_rate_limit_blocks_sixth_request(self):
        for index in range(5):
            status, _ = self.post({"category": "其他", "message": f"第 {index + 1} 条有效测试反馈", "website": ""})
            self.assertEqual(status, 201)
        status, _ = self.post({"category": "其他", "message": "第六条反馈应该被限制", "website": ""})
        self.assertEqual(status, 429)

    def test_admin_can_list_update_and_delete_feedback(self):
        self.post({"category": "问题", "message": "后台管理接口测试反馈", "website": ""})
        status, listing = self.request("/admin/feedback")
        self.assertEqual(status, 200)
        self.assertEqual(listing["count"], 1)
        record_id = listing["feedback"][0]["id"]

        status, _ = self.request(f"/admin/feedback/{record_id}", "PATCH", {"status": "done"})
        self.assertEqual(status, 200)
        _, done = self.request("/admin/feedback?status=done")
        self.assertEqual(done["count"], 1)

        status, _ = self.request(f"/admin/feedback/{record_id}", "DELETE")
        self.assertEqual(status, 200)
        _, empty = self.request("/admin/feedback")
        self.assertEqual(empty["count"], 0)


if __name__ == "__main__":
    unittest.main()
