# 梦缘资源站

一个持续生长的内容分享网站，目前包含：

- 首页：小游戏、学习资料和内容入口
- 校园生存指南：校车、食堂、地图、选课评价和校内资讯
- 立信学生资料库：通知分类、搜索、详情阅读与原文溯源
- 意见箱：公开反馈表单与微信联系方式

## 本地查看

推荐直接使用一键启动脚本，它会同时启动：

- 本地后端：`127.0.0.1:8787`
- 本地预览代理：`127.0.0.1:8080`
- `8080` 会同时提供静态页面和 `/api/...` 转发，不再需要手动开 SSH 隧道

PowerShell：

```powershell
.\scripts\start-local.ps1
```

停止本地环境：

```powershell
.\scripts\stop-local.ps1
```

启动后可直接访问：

- 首页：`http://127.0.0.1:8080/index.html`
- 资料后台：`http://127.0.0.1:8080/resources-admin.html`
- 学长学姐后台：`http://127.0.0.1:8080/senior-admin.html`

## 反馈服务

反馈接口是一个仅使用 Python 标准库的本地 HTTP 服务：

```bash
FEEDBACK_DATA_DIR=./data python server/feedback_server.py
```

生产环境通过 Nginx 将 `/api/feedback` 转发到 `127.0.0.1:8787/feedback`。提交内容保存在服务端私有目录，不会在网页公开展示。

资料库管理页可直接通过浏览器访问 `/resources-admin.html`。生产环境下后台页面与 `/api/admin/` 接口受单独的管理员登录保护，登录后即可管理资料、排行榜和学长学姐说内容。
