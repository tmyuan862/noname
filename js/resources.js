(function () {
  var labels = { activity_competition: "活动竞赛", course_selection: "选课通知", exchange: "交流交换", fees: "费用缴纳", holiday: "假期安排", library: "图书馆", registration: "报到注册", safety: "安全提示", transportation: "校园交通", other: "其他" };
  var list = document.querySelector("[data-resource-list]");
  var detail = document.querySelector("[data-resource-detail]");
  var categories = document.querySelector("[data-categories]");
  var search = document.querySelector("[data-search]");
  var pagination = document.querySelector("[data-pagination]");
  var pageLabel = document.querySelector("[data-page-label]");
  var previous = document.querySelector("[data-page-prev]");
  var next = document.querySelector("[data-page-next]");
  var initialParams = new URLSearchParams(window.location.search);
  var activeCategory = initialParams.get("category") || "";
  var currentPage = Math.max(1, Number(initialParams.get("page")) || 1);
  var timer;
  search.value = initialParams.get("q") || "";

  function api(url) {
    return fetch(url, { cache: "no-store" }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) { var error = new Error(data.message || "请求失败"); error.status = response.status; throw error; }
        return data;
      });
    });
  }

  function syncUrl() {
    var params = new URLSearchParams();
    if (activeCategory) params.set("category", activeCategory);
    if (search.value.trim()) params.set("q", search.value.trim());
    if (currentPage > 1) params.set("page", String(currentPage));
    history.replaceState(null, "", window.location.pathname + (params.toString() ? "?" + params : ""));
  }

  function categoryButton(label, value, count) {
    var element = document.createElement("button");
    element.type = "button"; element.textContent = label + (typeof count === "number" ? " " + count : ""); element.dataset.category = value;
    if (value === activeCategory) element.classList.add("active");
    element.addEventListener("click", function () {
      activeCategory = value; currentPage = 1;
      categories.querySelectorAll("button").forEach(function (button) { button.classList.remove("active"); });
      element.classList.add("active"); load();
    });
    return element;
  }

  function renderCategories(map, total) {
    categories.textContent = ""; categories.appendChild(categoryButton("全部", "", total));
    Object.keys(map).sort().forEach(function (key) { categories.appendChild(categoryButton(labels[key] || key, key, map[key])); });
  }

  function showDetail(id, card) {
    detail.innerHTML = '<div class="detail-empty"><span>正在读取</span><p>仅按需加载这一条资料正文。</p></div>'; detail.classList.add("open");
    api("/api/resources/" + encodeURIComponent(id)).then(function (data) {
      var resource = data.resource; detail.textContent = "";
      var box = document.createElement("div"); box.className = "detail-content";
      var top = document.createElement("div"); top.className = "detail-top";
      var category = document.createElement("span"); category.textContent = labels[resource.category] || resource.category;
      var date = document.createElement("span"); date.textContent = resource.publish_date || "日期未注明"; top.append(category, date);
      var title = document.createElement("h2"); title.textContent = resource.title;
      var source = document.createElement("p"); source.className = "detail-source"; source.textContent = "来源：" + (resource.department || "学校官网");
      var body = document.createElement("div"); body.className = "detail-body"; body.textContent = resource.content;
      var link = document.createElement("a"); link.className = "original-link"; link.href = resource.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "查看学校官网原文";
      box.append(top, title, source, body, link); detail.appendChild(box);
      document.querySelectorAll(".notice-card").forEach(function (item) { item.classList.remove("active"); }); if (card) card.classList.add("active");
    }).catch(function (error) {
      detail.innerHTML = '<div class="detail-empty"><span>暂时无法打开</span><p></p></div>';
      detail.querySelector("p").textContent = error.status === 429 ? "正文读取较频繁，请稍后再试，也可以直接访问学校官网。" : "资料暂时无法读取，请稍后再试。";
    });
  }

  function renderPagination(data) {
    pagination.hidden = data.total_pages <= 1; pageLabel.textContent = "第 " + data.page + " / " + data.total_pages + " 页";
    previous.disabled = data.page <= 1; next.disabled = !data.has_next;
  }

  function load() {
    var params = new URLSearchParams({ page: String(currentPage), page_size: "8" });
    if (activeCategory) params.set("category", activeCategory); if (search.value.trim()) params.set("q", search.value.trim());
    list.innerHTML = '<p class="library-state">正在加载资料……</p>'; syncUrl();
    api("/api/resources?" + params).then(function (data) {
      var total = Object.values(data.categories || {}).reduce(function (sum, count) { return sum + count; }, 0);
      document.querySelector("[data-total]").textContent = total + " 条资料"; document.querySelector("[data-result-count]").textContent = "找到 " + data.count + " 条";
      if (!categories.children.length) renderCategories(data.categories, total); renderPagination(data); list.textContent = "";
      if (!data.resources.length) { list.innerHTML = '<p class="library-state">没有找到相关资料，换个关键词试试。</p>'; return; }
      data.resources.forEach(function (resource) {
        var card = document.createElement("button"); card.type = "button"; card.className = "notice-card";
        var meta = document.createElement("div"); meta.className = "notice-meta";
        var category = document.createElement("span"); category.className = "notice-category"; category.textContent = labels[resource.category] || resource.category;
        var date = document.createElement("span"); date.textContent = resource.publish_date || "日期未注明"; meta.append(category, date);
        var title = document.createElement("h2"); title.textContent = resource.title;
        var summary = document.createElement("p"); summary.textContent = resource.summary; card.append(meta, title, summary);
        card.addEventListener("click", function () { showDetail(resource.id, card); }); list.appendChild(card);
      });
    }).catch(function (error) {
      pagination.hidden = true; list.innerHTML = '<p class="library-state"></p>';
      list.querySelector("p").textContent = error.status === 429 ? "访问较频繁，请稍后再试。" : "资料暂时无法读取，请稍后再试。";
    });
  }

  previous.addEventListener("click", function () { if (currentPage > 1) { currentPage -= 1; load(); window.scrollTo({ top: 0, behavior: "smooth" }); } });
  next.addEventListener("click", function () { currentPage += 1; load(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  search.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { currentPage = 1; load(); }, 420); });
  detail.addEventListener("click", function (event) { if (window.innerWidth <= 840 && event.target === detail.firstElementChild) detail.classList.remove("open"); });
  load();
}());
