(function () {
  var list = document.querySelector("[data-feedback-list]");
  var template = document.querySelector("#feedback-template");
  var tabs = document.querySelectorAll("[data-status]");
  var currentStatus = "";

  function request(url, options) {
    return fetch(url, options).then(function (response) {
      if (!response.ok) throw new Error("请求失败");
      return response.json();
    });
  }

  function loadFeedback() {
    list.innerHTML = '<p class="loading-state">正在读取反馈……</p>';
    var query = currentStatus ? "?status=" + encodeURIComponent(currentStatus) : "";
    request("/api/admin/feedback" + query).then(function (data) {
      document.querySelector("[data-count-all]").textContent = String(data.count);
      list.textContent = "";
      if (!data.feedback.length) {
        var empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "这个分类里还没有反馈。";
        list.appendChild(empty);
        return;
      }
      data.feedback.forEach(function (record) {
        var item = template.content.cloneNode(true);
        item.querySelector("[data-category]").textContent = record.category;
        item.querySelector("[data-message]").textContent = record.message;
        item.querySelector("[data-time]").textContent = new Date(record.created_at).toLocaleString("zh-CN");
        var state = item.querySelector("[data-state]");
        state.value = record.status;
        var publicToggle = item.querySelector("[data-public]");
        publicToggle.checked = !!record.public;
        publicToggle.addEventListener("change", function () {
          request("/api/admin/feedback/" + record.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: state.value, public: publicToggle.checked }) });
        });
        var reply = item.querySelector("[data-reply]");
        var replyStatus = item.querySelector("[data-reply-status]");
        reply.value = record.reply || "";
        item.querySelector("[data-send-reply]").addEventListener("click", function () {
          var value = reply.value.trim();
          if (!value) { replyStatus.textContent = "请先填写回复。"; return; }
          replyStatus.textContent = "正在保存……";
          request("/api/admin/feedback/" + record.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done", reply: value }) }).then(function () {
            replyStatus.textContent = "回信已保存，提交者下次打开网站即可看到。";
            state.value = "done";
          });
        });
        state.addEventListener("change", function () {
          request("/api/admin/feedback/" + record.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: state.value }) }).then(loadFeedback);
        });
        item.querySelector("[data-delete]").addEventListener("click", function () {
          if (!window.confirm("确定删除这条反馈吗？此操作不能撤销。")) return;
          request("/api/admin/feedback/" + record.id, { method: "DELETE" }).then(loadFeedback);
        });
        list.appendChild(item);
      });
    }).catch(function () {
      list.innerHTML = '<p class="loading-state error-state">无法读取反馈，请确认 SSH 隧道仍在运行。</p>';
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (item) { item.classList.remove("active"); });
      tab.classList.add("active");
      currentStatus = tab.dataset.status;
      loadFeedback();
    });
  });
  document.querySelector("[data-refresh]").addEventListener("click", loadFeedback);
  loadFeedback();
})();
