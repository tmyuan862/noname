import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock
from urllib.parse import quote
from pathlib import Path
from types import SimpleNamespace

import feedback_server as api
import game_scores
import senior_voice
import site_chat


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
        self.original_senior_db = senior_voice.DB_FILE
        senior_voice.DB_FILE = api.DATA_DIR / "senior_voice.sqlite3"
        senior_voice.init_db()
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
        senior_voice.DB_FILE = self.original_senior_db
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

    def session_request(self, path, method="GET", payload=None, cookie="", csrf=""):
        body = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json"} if body else {}
        if cookie: headers["Cookie"] = cookie
        if csrf: headers["X-CSRF-Token"] = csrf
        request = urllib.request.Request(self.base_url + path, data=body, headers=headers, method=method)
        try: response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error: return error.code, json.loads(error.read()), error.headers
        return response.status, json.loads(response.read()), response.headers

    def test_valid_feedback_is_saved(self):
        status, response = self.post({"category": "建议", "message": "希望增加校园打印店的位置。", "website": ""})
        self.assertEqual(status, 201)
        self.assertTrue(response["ok"])
        record = json.loads(api.DATA_FILE.read_text(encoding="utf-8"))
        self.assertEqual(record["category"], "建议")
        self.assertEqual(record["message"], "希望增加校园打印店的位置。")
        self.assertNotIn("ip", record)

    def test_senior_author_must_change_password_and_admin_approves_post(self):
        status, created = self.request("/admin/senior/authors", "POST", {"username": "senior_01", "display_name": "计算机学院学姐", "password": "InitialPass123"})
        self.assertEqual(status, 201)
        status, login, headers = self.session_request("/senior/login", "POST", {"username": "senior_01", "password": "InitialPass123"})
        self.assertEqual(status, 200)
        cookie = headers.get("Set-Cookie").split(";", 1)[0]
        csrf = login["author"]["csrf_token"]
        status, _, _ = self.session_request("/senior/posts", "POST", {"title": "给新生的选课建议", "body": "这是足够长的投稿正文，用来说明选课前应该查看培养方案。"}, cookie, csrf)
        self.assertEqual(status, 403)
        status, _, _ = self.session_request("/senior/password", "PATCH", {"current_password": "InitialPass123", "new_password": "ChangedPass456"}, cookie, csrf)
        self.assertEqual(status, 200)
        status, submitted, _ = self.session_request("/senior/posts", "POST", {"title": "给新生的选课建议", "body": "这是足够长的投稿正文，用来说明选课前应该查看培养方案。"}, cookie, csrf)
        self.assertEqual(status, 201)
        _, public = self.request("/senior/posts")
        self.assertEqual(public["count"], 0)
        post_id = submitted["post"]["id"]
        self.assertEqual(self.request(f"/admin/senior/posts/{post_id}", "PATCH", {"status": "published"})[0], 200)
        _, public = self.request("/senior/posts")
        self.assertEqual(public["count"], 1)
        self.assertEqual(public["posts"][0]["display_name"], "计算机学院学姐")

    def test_admin_workspace_can_publish_with_dedicated_editor_identity(self):
        status, result = self.request("/admin/senior/import", "POST", {
            "title": "新生入学前需要准备什么",
            "body": "根据公开校园资料整理，新生应提前确认报到时间、校区地址和需要携带的材料。",
        })
        self.assertEqual(status, 201)
        self.assertEqual(result["post"]["display_name"], senior_voice.EDITOR_DISPLAY_NAME)
        _, public = self.request("/senior/posts")
        self.assertEqual(public["count"], 1)
        self.assertEqual(public["posts"][0]["display_name"], "梦缘校园整理员")

    def test_health_reports_platform_status(self):
        status, health = self.request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["app"], "梦缘资源站")
        self.assertIn("resources", health["counts"])
        self.assertFalse(health["email_enabled"])
        self.assertEqual(health["counts"]["snake_scores"], 0)

    def test_site_chat_returns_clickable_sources_before_ai_answer(self):
        source = [{"title": "校车运行安排", "url": "https://www.lixin.edu.cn/bus.htm", "category": "transportation", "detail": {"content": "校车每天七点三十分从浦东校区发车。"}}]
        self.request("/admin/resources/import", "POST", {"items": source})
        ai_payload = {"choices": [{"message": {"content": "校车每天七点三十分从浦东校区发车，具体调整请查看来源。"}}]}

        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *_): return None
            def read(self): return json.dumps(ai_payload, ensure_ascii=False).encode("utf-8")

        ai_config = SimpleNamespace(notice_ai_enabled=True, notice_ai_api_key="test-key", notice_ai_base_url="https://api.deepseek.com", notice_ai_model="deepseek-chat", data_dir=api.DATA_DIR)
        with mock.patch("site_chat.CONFIG", ai_config), mock.patch("site_chat.AI_URLOPEN", return_value=FakeResponse()):
            status, response = self.request("/site-chat", "POST", {"question": "校车几点发车？"})
        self.assertEqual(status, 200)
        self.assertEqual(response["mode"], "ai")
        self.assertTrue(response["sources"][0]["url"].startswith("resources.html?open="))
        self.assertIn("七点三十分", response["answer"])

    def test_resource_detail_collapses_official_page_layout_linebreaks(self):
        source = [{"title": "图书馆施工通知", "url": "https://www.lixin.edu.cn/library.htm", "category": "library", "detail": {"content": "图书馆定于\n2026\n年\n7\n月\n9\n日\n至\n7\n月\n28\n日施工。\n\n请提前安排借阅。"}}]
        self.request("/admin/resources/import", "POST", {"items": source})
        _, listing = self.request("/resources")
        status, detail = self.request("/resources/" + listing["resources"][0]["id"])
        self.assertEqual(status, 200)
        self.assertIn("2026 年 7 月 9 日 至 7 月 28 日施工。", detail["resource"]["content"])
        self.assertNotIn("2026\n年", detail["resource"]["content"])

    def test_ai_reformat_preserves_resource_metadata_and_updates_content(self):
        source = [{"title": "安全工作提示", "url": "https://www.lixin.edu.cn/safety.htm", "category": "safety", "detail": {"content": "各单位：做好安全检查。1. 关闭门窗。2. 注意出行。"}}]
        self.request("/admin/resources/import", "POST", {"items": source})
        ai_payload = {"choices": [{"message": {"content": json.dumps({"content": "各单位：做好安全检查。\n\n1. 关闭门窗。\n\n2. 注意出行。"}, ensure_ascii=False)}}]}

        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *_): return None
            def read(self): return json.dumps(ai_payload, ensure_ascii=False).encode("utf-8")

        ai_config = SimpleNamespace(notice_ai_enabled=True, notice_ai_api_key="test-key", notice_ai_base_url="https://api.deepseek.com", notice_ai_model="deepseek-chat", data_dir=api.DATA_DIR)
        with mock.patch("feedback_server.CONFIG", ai_config), mock.patch("feedback_server.AI_URLOPEN", return_value=FakeResponse()):
            result = api.reformat_resources_with_ai()
        self.assertEqual(result["updated"], 1)
        record = api.load_resources()[0]
        self.assertEqual(record["title"], "安全工作提示")
        self.assertIn("\n\n1. 关闭门窗。", record["content"])

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

    def test_admin_reply_is_only_visible_with_private_feedback_key(self):
        status, submitted = self.post({"category": "建议", "message": "希望增加一项新的校园服务说明", "website": ""})
        self.assertEqual(status, 201)
        ticket, reply_key = submitted["ticket"], submitted["reply_key"]
        self.assertEqual(self.request(f"/feedback/reply?ticket={ticket}&key=wrong")[0], 404)
        status, _ = self.request(f"/admin/feedback/{ticket}", "PATCH", {"status": "done", "reply": "已经收到，我们会在下一次资料更新时补充。"})
        self.assertEqual(status, 200)
        status, response = self.request(f"/feedback/reply?ticket={ticket}&key={quote(reply_key)}")
        self.assertEqual(status, 200)
        self.assertEqual(response["feedback"]["reply"], "已经收到，我们会在下一次资料更新时补充。")

    def test_new_feedback_and_reply_appear_in_public_history(self):
        _, submitted = self.post({"category": "问题", "message": "公开反馈历史功能测试内容", "website": ""})
        ticket = submitted["ticket"]
        self.request(f"/admin/feedback/{ticket}", "PATCH", {"status": "done", "reply": "这条回复可以在公开历史中看到。"})
        status, history = self.request("/feedback/public")
        self.assertEqual(status, 200)
        self.assertEqual(history["count"], 1)
        self.assertEqual(history["feedback"][0]["reply"], "这条回复可以在公开历史中看到。")

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

    def test_pasted_notice_is_analyzed_before_publication(self):
        pasted = """关于2026年暑期校车运行安排的通知
发布日期：2026-07-10
暑假期间校车每日七点三十分从浦东校区发车，请提前候车。
咨询电话：021-12345678
后勤保障处
原文：https://www.lixin.edu.cn/bus-2026.htm"""
        status, analyzed = self.request("/admin/resources/analyze", "POST", {"text": pasted})
        self.assertEqual(status, 200)
        draft = analyzed["draft"]
        self.assertEqual(draft["title"], "关于2026年暑期校车运行安排的通知")
        self.assertEqual(draft["category"], "transportation")
        self.assertEqual(draft["publish_date"], "2026-07-10")
        self.assertEqual(draft["department"], "后勤保障处")
        self.assertEqual(draft["url"], "https://www.lixin.edu.cn/bus-2026.htm")
        self.assertIn("校车每日七点三十分", draft["content"])
        status, imported = self.request("/admin/resources/import", "POST", {"items": [draft]})
        self.assertEqual(status, 200)
        self.assertEqual(imported["inserted"], 1)
        _, listing = self.request("/resources?q=" + quote("校车"))
        self.assertEqual(listing["count"], 1)

    def test_pasted_notice_analysis_rejects_short_text(self):
        status, response = self.request("/admin/resources/analyze", "POST", {"text": "太短"})
        self.assertEqual(status, 422)
        self.assertEqual(response["error"], "invalid_notice")

    def test_ai_notice_analysis_uses_structured_result_and_keeps_local_source(self):
        pasted = "关于暑期班车的通知\n2026年7月10日每日发车。\n原文：https://www.lixin.edu.cn/source.htm"
        ai_payload = {"choices": [{"message": {"content": json.dumps({
            "title": "暑期班车安排",
            "category": "transportation",
            "summary": "暑期班车运行安排。",
            "content": "2026年7月10日每日发车。",
            "publish_date": "2026-07-11",
            "department": "后勤保障处",
        }, ensure_ascii=False)}}]}

        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *_): return None
            def read(self): return json.dumps(ai_payload, ensure_ascii=False).encode("utf-8")

        ai_config = SimpleNamespace(notice_ai_enabled=True, notice_ai_api_key="test-key", notice_ai_base_url="https://api.deepseek.com", notice_ai_model="deepseek-chat")
        with mock.patch("feedback_server.CONFIG", ai_config), mock.patch("feedback_server.AI_URLOPEN", return_value=FakeResponse()):
            status, response = self.request("/admin/resources/analyze", "POST", {"text": pasted, "mode": "ai"})
        self.assertEqual(status, 200)
        self.assertEqual(response["analysis_mode"], "ai")
        self.assertEqual(response["draft"]["url"], "https://www.lixin.edu.cn/source.htm")
        self.assertEqual(response["draft"]["publish_date"], "2026-07-10")

    def test_webpage_analysis_extracts_content_and_images_with_ai(self):
        html = """
        <html><head><title>2026 秋季校车安排</title></head><body>
        <article>
          <h1>关于 2026 秋季校车安排的通知</h1>
          <p>发布时间：2026-09-01</p>
          <p>后勤保障处</p>
          <p>浦东校区至松江校区校车将于工作日 7:30 发车。</p>
          <img src="https://www.lixin.edu.cn/images/bus-map.jpg" />
          <img src="/images/bus-table.png" />
        </article>
        </body></html>
        """
        ai_payload = {"choices": [{"message": {"content": json.dumps({
            "title": "2026 秋季校车安排",
            "category": "transportation",
            "summary": "工作日 7:30 发车，建议提前候车。",
            "content": "工作日 7:30 从浦东校区发车，具体线路见配图。",
            "publish_date": "2026-09-01",
            "department": "后勤保障处",
            "picked_image_urls": [
                "https://www.lixin.edu.cn/images/bus-map.jpg",
                "https://www.lixin.edu.cn/images/bus-table.png",
            ],
        }, ensure_ascii=False)}}]}

        class FakeWebResponse:
            def __enter__(self): return self
            def __exit__(self, *_): return None
            def read(self, *_): return html.encode("utf-8")
            def geturl(self): return "https://www.lixin.edu.cn/bus-2026.html"
            @property
            def headers(self): return {"Content-Type": "text/html; charset=utf-8"}

        class FakeAiResponse:
            def __enter__(self): return self
            def __exit__(self, *_): return None
            def read(self): return json.dumps(ai_payload, ensure_ascii=False).encode("utf-8")

        ai_config = SimpleNamespace(notice_ai_enabled=True, notice_ai_api_key="test-key", notice_ai_base_url="https://api.deepseek.com", notice_ai_model="deepseek-chat")
        with mock.patch("feedback_server.is_private_hostname", return_value=False), \
             mock.patch("feedback_server.WEB_URLOPEN", return_value=FakeWebResponse()), \
             mock.patch("feedback_server.AI_URLOPEN", return_value=FakeAiResponse()), \
             mock.patch("feedback_server.CONFIG", ai_config):
            status, response = self.request("/admin/resources/analyze-url", "POST", {"url": "https://www.lixin.edu.cn/bus-2026.html"})
        self.assertEqual(status, 200)
        self.assertEqual(response["analysis_mode"], "ai")
        self.assertEqual(response["draft"]["category"], "transportation")
        self.assertEqual(len(response["draft"]["image_urls"]), 2)
        self.assertTrue(response["draft"]["image_urls"][1].endswith("/images/bus-table.png"))

    def test_wechat_webpage_analysis_defaults_to_summary_only_mode(self):
        html = """
        <html><head><title>迎新报到指引</title></head><body>
        <article>
          <h1>2026 级新生报到指引</h1>
          <p>发布时间：2026-08-20</p>
          <p>学生处</p>
          <p>请新生按时报到，提前准备身份证、录取通知书等材料。</p>
          <img src="https://mmbiz.qpic.cn/test-cover.jpg" />
        </article>
        </body></html>
        """
        ai_payload = {"choices": [{"message": {"content": json.dumps({
            "title": "2026 级新生报到指引",
            "category": "registration",
            "summary": "新生需提前准备身份证、录取通知书等材料，并按时报到。",
            "content": "请新生按时报到，提前准备身份证、录取通知书等材料。",
            "publish_date": "2026-08-20",
            "department": "学生处",
            "picked_image_urls": ["https://mmbiz.qpic.cn/test-cover.jpg"],
        }, ensure_ascii=False)}}]}

        class FakeWebResponse:
            def __enter__(self): return self
            def __exit__(self, *_): return None
            def read(self, *_): return html.encode("utf-8")
            def geturl(self): return "https://mp.weixin.qq.com/s/example123"
            @property
            def headers(self): return {"Content-Type": "text/html; charset=utf-8"}

        class FakeAiResponse:
            def __enter__(self): return self
            def __exit__(self, *_): return None
            def read(self): return json.dumps(ai_payload, ensure_ascii=False).encode("utf-8")

        ai_config = SimpleNamespace(notice_ai_enabled=True, notice_ai_api_key="test-key", notice_ai_base_url="https://api.deepseek.com", notice_ai_model="deepseek-chat")
        with mock.patch("feedback_server.is_private_hostname", return_value=False), \
             mock.patch("feedback_server.WEB_URLOPEN", return_value=FakeWebResponse()), \
             mock.patch("feedback_server.AI_URLOPEN", return_value=FakeAiResponse()), \
             mock.patch("feedback_server.CONFIG", ai_config):
            status, response = self.request("/admin/resources/analyze-url", "POST", {"url": "https://mp.weixin.qq.com/s/example123"})
        self.assertEqual(status, 200)
        self.assertEqual(response["compliance_mode"], "summary_only")
        self.assertEqual(response["draft"]["image_urls"], [])
        self.assertIn("站内摘要导览", response["draft"]["content"])
        self.assertIn("微信公众号", response["message"])

    def test_webpage_analysis_rejects_redirect_to_private_address(self):
        class RedirectedResponse:
            def __enter__(self): return self
            def __exit__(self, *_): return None
            def read(self, *_): return b"<html><body><p>private content</p></body></html>"
            def geturl(self): return "http://127.0.0.1/internal"
            @property
            def headers(self): return {"Content-Type": "text/html; charset=utf-8"}

        with mock.patch("feedback_server.is_private_hostname", side_effect=[False, True]), \
             mock.patch("feedback_server.WEB_URLOPEN", return_value=RedirectedResponse()):
            result, message = api.fetch_notice_webpage("https://www.lixin.edu.cn/redirect")
        self.assertIsNone(result)
        self.assertIn("受限地址", message)

    def test_resource_import_preserves_image_urls(self):
        source = [{
            "title": "校车路线图",
            "url": "https://www.lixin.edu.cn/bus-gallery.htm",
            "category": "transportation",
            "content": "校车路线图与时刻表。",
            "image_urls": [
                "https://www.lixin.edu.cn/images/route.jpg",
                "https://www.lixin.edu.cn/images/time.png",
            ],
        }]
        self.request("/admin/resources/import", "POST", {"items": source})
        _, listing = self.request("/resources")
        status, detail = self.request("/resources/" + listing["resources"][0]["id"])
        self.assertEqual(status, 200)
        self.assertEqual(len(detail["resource"]["image_urls"]), 2)

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
