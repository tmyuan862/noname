import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from urllib.parse import quote
from pathlib import Path

import feedback_server as api
import game_scores


class FeedbackApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        api.DATA_DIR = Path(self.temp_dir.name)
        api.DATA_FILE = api.DATA_DIR / "feedback.jsonl"
        api.RESOURCE_FILE = api.DATA_DIR / "resources.json"
        api.request_times.clear()
        api.public_request_times.clear()
        self.original_score_db = game_scores.DB_FILE
        self.original_session_min = game_scores.SESSION_MIN_SECONDS
        self.original_use_wal = game_scores.USE_WAL
        game_scores.DB_FILE = api.DATA_DIR / "snake_scores.sqlite3"
        game_scores.SESSION_MIN_SECONDS = 0
        game_scores.USE_WAL = False
        game_scores.sessions.clear()
        game_scores.init_db()
        self.server = api.ThreadingHTTPServer(("127.0.0.1", 0), api.FeedbackHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        game_scores.DB_FILE = self.original_score_db
        game_scores.SESSION_MIN_SECONDS = self.original_session_min
        game_scores.USE_WAL = self.original_use_wal
        game_scores.sessions.clear()
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

    def test_health_reports_platform_status(self):
        status, health = self.request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["app"], "梦缘资源站")
        self.assertIn("resources", health["counts"])
        self.assertFalse(health["email_enabled"])
        self.assertEqual(health["counts"]["snake_scores"], 0)

    def test_game_score_session_submission_and_leaderboard(self):
        status, session = self.request("/game/session")
        self.assertEqual(status, 200)

        status, submitted = self.request("/game/scores", "POST", {
            "token": session["token"], "name": "Player", "score": 120,
            "mode": "classic", "diff": "normal",
        })
        self.assertEqual(status, 201)
        self.assertEqual(submitted["score"]["score"], 120)

        status, listing = self.request("/game/leaderboard")
        self.assertEqual(status, 200)
        self.assertEqual(listing["scores"][0]["name"], "Player")

        status, _ = self.request("/game/scores", "POST", {
            "token": session["token"], "name": "Replay", "score": 100,
            "mode": "classic", "diff": "normal",
        })
        self.assertEqual(status, 422)

    def test_admin_can_hide_restore_and_delete_game_score(self):
        _, session = self.request("/game/session")
        self.request("/game/scores", "POST", {
            "token": session["token"], "name": "Admin Test", "score": 88,
            "mode": "level", "diff": "hard",
        })
        _, scores = self.request("/admin/game/scores")
        record_id = scores["scores"][0]["id"]

        status, _ = self.request(f"/admin/game/scores/{record_id}", "PATCH", {"status": "hidden"})
        self.assertEqual(status, 200)
        _, public = self.request("/game/leaderboard")
        self.assertEqual(public["count"], 0)

        status, _ = self.request(f"/admin/game/scores/{record_id}", "PATCH", {"status": "visible"})
        self.assertEqual(status, 200)
        _, public = self.request("/game/leaderboard")
        self.assertEqual(public["count"], 1)

        status, _ = self.request(f"/admin/game/scores/{record_id}", "DELETE")
        self.assertEqual(status, 200)

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

    def test_resources_can_be_imported_searched_and_deleted(self):
        source = [{
            "title": "关于校车安排的通知",
            "url": "https://www.lixin.edu.cn/example.htm",
            "category": "transportation",
            "detail": {
                "content": "学校导航\n点击率：\n校车每天七点三十分发车。\n分享到：",
                "publish_date": "2026-07-10",
                "department": "后勤保障处",
            },
        }]
        status, imported = self.request("/admin/resources/import", "POST", {"items": source})
        self.assertEqual(status, 200)
        self.assertEqual(imported["inserted"], 1)

        _, listing = self.request("/resources?q=" + quote("校车"))
        self.assertEqual(listing["count"], 1)
        self.assertEqual(listing["page"], 1)
        self.assertFalse(listing["has_next"])
        resource_id = listing["resources"][0]["id"]
        self.assertNotIn("content", listing["resources"][0])

        _, detail = self.request(f"/resources/{resource_id}")
        self.assertEqual(detail["resource"]["content"], "校车每天七点三十分发车。")

        status, _ = self.request(f"/admin/resources/{resource_id}", "DELETE")
        self.assertEqual(status, 200)
        _, empty = self.request("/resources")
        self.assertEqual(empty["count"], 0)

    def test_resource_listing_is_paginated_and_page_size_is_capped(self):
        source = [{
            "title": f"校园资料 {index}",
            "url": f"https://www.lixin.edu.cn/resource-{index}.htm",
            "category": "other",
            "detail": {"content": f"第 {index} 条校园资料完整正文。"},
        } for index in range(15)]
        self.request("/admin/resources/import", "POST", {"items": source})

        _, first = self.request("/resources?page=1&page_size=100")
        self.assertEqual(first["count"], 15)
        self.assertEqual(len(first["resources"]), api.PUBLIC_RESOURCE_MAX_PAGE_SIZE)
        self.assertTrue(first["has_next"])
        self.assertNotIn("content", first["resources"][0])

        _, second = self.request("/resources?page=2&page_size=12")
        self.assertEqual(len(second["resources"]), 3)
        self.assertFalse(second["has_next"])

    def test_resource_detail_rate_limit_returns_429(self):
        original_limit = api.RESOURCE_DETAIL_RATE_LIMIT
        api.RESOURCE_DETAIL_RATE_LIMIT = 2
        try:
            source = [{
                "title": "限流测试资料",
                "url": "https://www.lixin.edu.cn/rate-limit.htm",
                "category": "other",
                "detail": {"content": "用于验证正文访问频率限制。"},
            }]
            self.request("/admin/resources/import", "POST", {"items": source})
            _, listing = self.request("/resources")
            record_id = listing["resources"][0]["id"]
            self.assertEqual(self.request(f"/resources/{record_id}")[0], 200)
            self.assertEqual(self.request(f"/resources/{record_id}")[0], 200)
            status, response = self.request(f"/resources/{record_id}")
            self.assertEqual(status, 429)
            self.assertEqual(response["error"], "rate_limit")
        finally:
            api.RESOURCE_DETAIL_RATE_LIMIT = original_limit

    def test_resource_import_rejects_non_array(self):
        status, _ = self.request("/admin/resources/import", "POST", {"items": "not-a-list"})
        self.assertEqual(status, 422)

    def test_event_misclassified_as_safety_is_recategorized(self):
        source = [{
            "title": "校园主题发布会通知",
            "url": "https://www.lixin.edu.cn/event.htm",
            "category": "safety",
            "detail": {"content": "点击率：\n发布会将于本周举行。\n分享到："},
        }]
        self.request("/admin/resources/import", "POST", {"items": source})
        _, listing = self.request("/resources")
        self.assertEqual(listing["resources"][0]["category"], "activity_competition")


if __name__ == "__main__":
    unittest.main()
