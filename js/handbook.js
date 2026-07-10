(function () {
  var toc = document.querySelector("[data-handbook-toc]");
  var chapters = document.querySelector("[data-handbook-chapters]");
  var searchInput = document.querySelector("[data-handbook-search]");
  if (!toc || !chapters) return;

  function inlineText(target, value) {
    String(value).split(/(\*\*[^*]+\*\*)/g).forEach(function (part) {
      if (part.startsWith("**") && part.endsWith("**")) {
        var strong = document.createElement("strong"); strong.textContent = part.slice(2, -2); target.appendChild(strong);
      } else { target.appendChild(document.createTextNode(part)); }
    });
  }

  function block(tag, value) {
    var node = document.createElement(tag); inlineText(node, value); return node;
  }

  function render(source) {
    var sections = source.split(/^##\s+/m).slice(1).map(function (part) {
      var lines = part.trim().split("\n");
      return { title: lines.shift().trim(), lines: lines };
    }).filter(function (section) { return section.title; });
    toc.textContent = ""; chapters.textContent = "";
    sections.forEach(function (section, index) {
      var id = "handbook-chapter-" + (index + 1);
      var link = document.createElement("a");
      link.href = "#" + id;
      link.textContent = section.title;
      link.dataset.target = id;
      toc.appendChild(link);
      var article = document.createElement("article"); article.id = id;
      article.dataset.title = section.title.toLowerCase();
      article.appendChild(block("h3", section.title));
      var list;
      section.lines.forEach(function (line) {
        var text = line.trim();
        if (!text || text === "---") { list = null; return; }
        if (/^(?:-|\d+\.)\s+/.test(text)) {
          if (!list) { list = document.createElement("ul"); article.appendChild(list); }
          list.appendChild(block("li", text.replace(/^(?:-|\d+\.)\s+/, ""))); return;
        }
        list = null;
        if (/^\*\*.+\*\*$/.test(text)) article.appendChild(block("h4", text));
        else article.appendChild(block("p", text));
      });
      article.dataset.search = (section.title + " " + section.lines.join(" ")).toLowerCase();
      chapters.appendChild(article);
    });

    bindSearch();
    bindActiveState();
  }

  function bindSearch() {
    if (!searchInput) return;
    var empty = null;

    function ensureEmptyState() {
      if (empty) return empty;
      empty = document.createElement("p");
      empty.className = "handbook-empty";
      empty.textContent = "没有找到匹配内容，请换一个关键词试试。";
      return empty;
    }

    function applyFilter() {
      var keyword = searchInput.value.trim().toLowerCase();
      var items = chapters.querySelectorAll("article");
      var visibleCount = 0;

      items.forEach(function (article) {
        var matches = !keyword || (article.dataset.search || "").indexOf(keyword) !== -1;
        article.classList.toggle("is-hidden", !matches);
        var link = toc.querySelector('[data-target="' + article.id + '"]');
        if (link) link.classList.toggle("is-hidden", !matches);
        if (matches) visibleCount += 1;
      });

      if (!visibleCount) {
        if (!empty || !chapters.contains(empty)) chapters.appendChild(ensureEmptyState());
      } else if (empty && chapters.contains(empty)) {
        chapters.removeChild(empty);
      }
    }

    searchInput.addEventListener("input", applyFilter);
    applyFilter();
  }

  function bindActiveState() {
    var links = Array.prototype.slice.call(toc.querySelectorAll("a"));
    var articles = Array.prototype.slice.call(chapters.querySelectorAll("article"));
    if (!links.length || !articles.length) return;

    function setActive(id) {
      links.forEach(function (link) {
        link.classList.toggle("is-active", link.dataset.target === id);
      });
    }

    function pickVisibleArticle() {
      var current = articles.find(function (article) {
        return !article.classList.contains("is-hidden") && article.getBoundingClientRect().top >= 100;
      });
      if (!current) {
        current = articles.find(function (article) {
          return !article.classList.contains("is-hidden");
        });
      }
      if (current) setActive(current.id);
    }

    window.addEventListener("scroll", pickVisibleArticle, { passive: true });
    window.addEventListener("hashchange", function () {
      setActive((location.hash || "").slice(1));
    });

    links.forEach(function (link) {
      link.addEventListener("click", function () {
        setActive(link.dataset.target);
      });
    });

    setActive((location.hash || "").slice(1));
    pickVisibleArticle();
  }

  fetch("data/handbook-key-chapters.md", { cache: "no-store" }).then(function (response) {
    if (!response.ok) throw new Error(); return response.text();
  }).then(render).catch(function () {
    toc.textContent = "完整章节暂时无法读取。";
    chapters.innerHTML = "<p class=\"handbook-loading\">完整章节暂时无法读取，请稍后再试。</p>";
  });
}());
