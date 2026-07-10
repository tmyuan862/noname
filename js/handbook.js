(function () {
  var toc = document.querySelector("[data-handbook-toc]");
  var chapters = document.querySelector("[data-handbook-chapters]");
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
      var link = document.createElement("a"); link.href = "#" + id; link.textContent = section.title; toc.appendChild(link);
      var article = document.createElement("article"); article.id = id;
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
      chapters.appendChild(article);
    });
  }

  fetch("data/handbook-key-chapters.md", { cache: "no-store" }).then(function (response) {
    if (!response.ok) throw new Error(); return response.text();
  }).then(render).catch(function () {
    toc.textContent = "完整章节暂时无法读取。";
    chapters.innerHTML = "<p class=\"handbook-loading\">完整章节暂时无法读取，请稍后再试。</p>";
  });
}());
