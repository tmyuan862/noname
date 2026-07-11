(function () {
  var labels = { activity_competition: "活动竞赛", course_selection: "选课通知", exchange: "交流交换", fees: "费用缴纳", holiday: "假期安排", library: "图书馆", registration: "报到注册", safety: "安全提示", transportation: "校园交通", other: "其他" };
  var input = document.querySelector("[data-file-input]");
  var importButton = document.querySelector("[data-import]");
  var uploadStatus = document.querySelector("[data-upload-status]");
  var list = document.querySelector("[data-admin-resources]");
  var template = document.querySelector("#admin-resource-template");
  var pasteText = document.querySelector("[data-paste-text]");
  var analyzeButton = document.querySelector("[data-analyze]");
  var pasteStatus = document.querySelector("[data-paste-status]");
  var preview = document.querySelector("[data-analysis-preview]");
  var analysisMode = "ai";
  var reformatButton = document.querySelector("[data-reformat-resources]");
  var webUrl = document.querySelector("[data-web-url]");
  var analyzeUrlButton = document.querySelector("[data-analyze-url]");

  function request(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || "请求失败");
        return data;
      });
    }).catch(function (error) {
      if (error && error.name === "TypeError") {
        throw new Error("当前页面没有连上本地后台服务，请先启动后端或改用线上后台地址。");
      }
      throw error;
    });
  }

  function setPasteStatus(message, type) {
    pasteStatus.textContent = message;
    pasteStatus.className = "paste-status" + (type ? " " + type : "");
  }

  function fillPreview(draft) {
    Object.keys(draft).forEach(function (name) {
      var field = preview.elements.namedItem(name);
      if (!field) return;
      field.value = name === "image_urls" && Array.isArray(draft[name])
        ? draft[name].join("\n")
        : draft[name] || "";
    });
    preview.hidden = false;
    preview.querySelector('[name="title"]').focus();
    preview.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function load() {
    list.innerHTML = '<p class="loading-state">正在读取资料……</p>';
    request("/api/admin/resources").then(function (data) {
      document.querySelector("[data-resource-count]").textContent = data.count + " 条";
      list.textContent = "";
      if (!data.resources.length) { list.innerHTML = '<p class="empty-state">还没有资料，可以粘贴通知或上传 JSON 文件。</p>'; return; }
      data.resources.forEach(function (resource) {
        var item = template.content.cloneNode(true);
        item.querySelector("[data-category]").textContent = labels[resource.category] || resource.category;
        item.querySelector("[data-date]").textContent = resource.publish_date || "日期未注明";
        item.querySelector("[data-title]").textContent = resource.title;
        item.querySelector("[data-source]").href = resource.url;
        item.querySelector("[data-delete]").addEventListener("click", function () {
          if (!confirm("确定删除这条资料吗？")) return;
          request("/api/admin/resources/" + resource.id, { method: "DELETE" }).then(load);
        });
        list.appendChild(item);
      });
    }).catch(function () { list.innerHTML = '<p class="loading-state error-state">无法读取资料，请确认 SSH 隧道仍在运行。</p>'; });
  }

  input.addEventListener("change", function () {
    var files = Array.from(input.files); importButton.disabled = !files.length; uploadStatus.className = "upload-status";
    uploadStatus.textContent = files.length ? "已选择 " + files.length + " 个文件" : "尚未选择文件";
  });

  importButton.addEventListener("click", async function () {
    var files = Array.from(input.files); if (!files.length) return; importButton.disabled = true;
    var totals = { inserted: 0, updated: 0, skipped: 0 };
    try {
      for (var file of files) {
        if (file.size > 2 * 1024 * 1024) throw new Error(file.name + " 超过 2MB");
        var items = JSON.parse(await file.text()); if (!Array.isArray(items)) throw new Error(file.name + " 不是 JSON 数组");
        var result = await request("/api/admin/resources/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: items }) });
        totals.inserted += result.inserted; totals.updated += result.updated; totals.skipped += result.skipped;
      }
      uploadStatus.className = "upload-status success"; uploadStatus.textContent = "导入完成：新增 " + totals.inserted + "，更新 " + totals.updated + "，跳过 " + totals.skipped; input.value = ""; load();
    } catch (error) { uploadStatus.className = "upload-status error"; uploadStatus.textContent = error.message || "导入失败"; }
    finally { importButton.disabled = !input.files.length; }
  });

  analyzeButton.addEventListener("click", function () {
    var text = pasteText.value.trim();
    if (text.length < 10) { setPasteStatus("请先粘贴一段完整通知。", "error"); return; }
    analyzeButton.disabled = true; setPasteStatus(analysisMode === "ai" ? "DeepSeek 正在整理内容……" : "正在本地识别标题、日期、部门和分类……");
    request("/api/admin/resources/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text, mode: analysisMode }) }).then(function (data) {
      fillPreview(data.draft);
      setPasteStatus(data.analysis_mode === "local_fallback" ? data.message : (data.analysis_mode === "ai" ? "AI 增强分析完成，请核对后发布。" : "本地分析完成，请核对后发布。"), data.analysis_mode === "local_fallback" ? "error" : "success");
    }).catch(function (error) { setPasteStatus(error.message || "分析失败，请稍后再试。", "error"); })
      .finally(function () { analyzeButton.disabled = false; });
  });

  document.querySelectorAll("[data-source-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      var mode = button.dataset.sourceMode;
      document.querySelectorAll("[data-source-mode]").forEach(function (item) { item.classList.toggle("active", item === button); });
      document.querySelectorAll("[data-source-panel]").forEach(function (panel) { panel.hidden = panel.dataset.sourcePanel !== mode; });
      setPasteStatus(mode === "url" ? "输入公开网页链接后，系统会抓取正文和图片。" : "粘贴完整通知后再选择分析方式。");
      (mode === "url" ? webUrl : pasteText).focus();
    });
  });

  analyzeUrlButton.addEventListener("click", function () {
    var url = webUrl.value.trim();
    if (!/^https?:\/\//i.test(url)) { setPasteStatus("请输入完整的 http 或 https 网页链接。", "error"); return; }
    analyzeUrlButton.disabled = true;
    setPasteStatus("正在抓取网页正文和图片，并交给 DeepSeek 整理……");
    request("/api/admin/resources/analyze-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url })
    }).then(function (data) {
      fillPreview(data.draft);
      var selectedCount = Array.isArray(data.draft.image_urls) ? data.draft.image_urls.length : 0;
      var imageText = selectedCount ? "，已选取 " + selectedCount + " 张图片" : "，未选取图片";
      setPasteStatus(
        data.analysis_mode === "ai"
          ? "网页分析完成" + imageText + "，请核对后发布。"
          : (data.message || "网页已生成本地草稿") + imageText,
        data.analysis_mode === "ai" ? "success" : "error"
      );
    }).catch(function (error) {
      setPasteStatus(error.message || "网页抓取失败，请确认链接可以公开访问。", "error");
    }).finally(function () {
      analyzeUrlButton.disabled = false;
    });
  });

  document.querySelectorAll("[data-analysis-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      analysisMode = button.dataset.analysisMode;
      document.querySelectorAll("[data-analysis-mode]").forEach(function (item) { item.classList.toggle("active", item === button); });
      setPasteStatus(analysisMode === "ai" ? "AI 增强会将本次通知发送给 DeepSeek。" : "本地模式不会发送给第三方。", "");
    });
  });

  preview.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!preview.reportValidity()) return;
    var publishButton = preview.querySelector('[type="submit"]'); publishButton.disabled = true; setPasteStatus("正在发布……");
    var draft = {};
    ["title", "category", "publish_date", "department", "url", "content"].forEach(function (name) { draft[name] = preview.elements.namedItem(name).value.trim(); });
    draft.image_urls = preview.elements.namedItem("image_urls").value
      .split(/\r?\n/)
      .map(function (value) { return value.trim(); })
      .filter(Boolean);
    var target = preview.elements.namedItem("publish_target").value;
    var publishRequest = target === "senior"
      ? request("/api/admin/senior/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: draft.title, body: draft.content }) })
      : request("/api/admin/resources/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [draft] }) });
    publishRequest.then(function (result) {
      if (target === "resources" && !result.inserted && !result.updated) throw new Error("资料未通过校验，请检查标题、正文和官网链接。");
      setPasteStatus(target === "senior" ? "已使用“梦缘校园整理员”发布到学长学姐说。" : (result.inserted ? "已发布一条新资料。" : "已更新相同信源的资料。"), "success");
      pasteText.value = ""; webUrl.value = ""; preview.reset(); preview.hidden = true; load();
    }).catch(function (error) { setPasteStatus(error.message || "发布失败。", "error"); })
      .finally(function () { publishButton.disabled = false; });
  });

  document.querySelector("[data-cancel-analysis]").addEventListener("click", function () { preview.hidden = true; preview.reset(); setPasteStatus("已取消本次分析。"); });
  reformatButton.addEventListener("click", function () {
    if (!confirm("将把全部已发布资料的正文发送给 DeepSeek，仅进行分段与编号排版整理，是否继续？")) return;
    reformatButton.disabled = true;
    reformatButton.textContent = "AI 正在整理…";
    request("/api/admin/resources/reformat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 100 }) }).then(function (result) {
      setPasteStatus("AI 排版整理完成：更新 " + result.updated + " 条" + (result.failed ? "，" + result.failed + " 条未修改。" : "。"), result.failed ? "error" : "success");
      load();
    }).catch(function (error) { setPasteStatus(error.message || "AI 排版整理失败。", "error"); })
      .finally(function () { reformatButton.disabled = false; reformatButton.textContent = "AI 整理全部排版"; });
  });
  document.querySelector("[data-refresh]").addEventListener("click", load);
  load();
}());
