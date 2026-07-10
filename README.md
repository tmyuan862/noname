# 零号共享站

一个持续生长的内容分享网站，目前包含：

- 首页：小游戏、学习资料和内容入口
- 校园生存指南：校车、食堂、地图、选课评价和校内资讯
- 立信学生资料库：通知分类、搜索、详情阅读与原文溯源
- 意见箱：公开反馈表单与微信联系方式

## 本地查看

静态页面可以直接打开，也可以在项目目录运行：

```bash
python -m http.server 8000
```

## 反馈服务

反馈接口是一个仅使用 Python 标准库的本地 HTTP 服务：

```bash
FEEDBACK_DATA_DIR=./data python server/feedback_server.py
```

生产环境通过 Nginx 将 `/api/feedback` 转发到 `127.0.0.1:8787/feedback`。提交内容保存在服务端私有目录，不会在网页公开展示。

资料库管理页通过 SSH 隧道访问 `/resources-admin.html`，支持上传原始 JSON 数组、按 URL 去重更新和删除资料。
