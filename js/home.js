(function () {
  if (window.lucide) {
    window.lucide.createIcons({ strokeWidth: 1.8 });
  }

  var menuButton = document.querySelector(".menu-button");
  var mobileNav = document.querySelector("#mobile-nav");

  function closeMenu() {
    if (!menuButton || !mobileNav) return;
    mobileNav.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "打开导航菜单");
  }

  if (menuButton && mobileNav) {
    menuButton.addEventListener("click", function () {
      var shouldOpen = mobileNav.hidden;
      mobileNav.hidden = !shouldOpen;
      menuButton.setAttribute("aria-expanded", String(shouldOpen));
      menuButton.setAttribute("aria-label", shouldOpen ? "关闭导航菜单" : "打开导航菜单");
    });

    mobileNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMenu);
    });
  }

  var year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();

  var copyButton = document.querySelector("[data-copy-wechat]");
  if (copyButton) {
    copyButton.addEventListener("click", function () {
      navigator.clipboard.writeText("Mty080602").then(function () {
        var label = copyButton.querySelector("span");
        if (label) label.textContent = "已复制";
        window.setTimeout(function () { if (label) label.textContent = "复制"; }, 1800);
      }).catch(function () {
        window.prompt("复制微信号", "Mty080602");
      });
    });
  }

  var feedbackForm = document.querySelector("[data-feedback-form]");
  if (feedbackForm) {
    var messageInput = feedbackForm.querySelector("[name='message']");
    var count = feedbackForm.querySelector("[data-character-count]");
    var status = feedbackForm.querySelector("[data-form-status]");
    var submitButton = feedbackForm.querySelector("button[type='submit']");
    var inbox = feedbackForm.querySelector("[data-feedback-inbox]");
    var replyList = feedbackForm.querySelector("[data-reply-list]");
    var receiptStorageKey = "mengyuan_feedback_receipts";

    function getReceipts() {
      try { return JSON.parse(localStorage.getItem(receiptStorageKey) || "[]"); } catch (_) { return []; }
    }

    function saveReceipt(ticket, key) {
      var receipts = getReceipts().filter(function (item) { return item.ticket !== ticket; });
      receipts.unshift({ ticket: ticket, key: key });
      localStorage.setItem(receiptStorageKey, JSON.stringify(receipts.slice(0, 10)));
    }

    function loadReplies() {
      var receipts = getReceipts();
      inbox.hidden = !receipts.length;
      replyList.textContent = "";
      receipts.forEach(function (receipt) {
        fetch("/api/feedback/reply?ticket=" + encodeURIComponent(receipt.ticket) + "&key=" + encodeURIComponent(receipt.key), { cache: "no-store" })
          .then(function (response) { if (!response.ok) throw new Error(); return response.json(); })
          .then(function (data) {
            var record = data.feedback;
            var article = document.createElement("article"); article.className = "feedback-receipt";
            var head = document.createElement("header");
            var category = document.createElement("strong"); category.textContent = record.category;
            var state = document.createElement("span"); state.textContent = record.reply ? "已回信" : "等待回复";
            head.append(category, state);
            var original = document.createElement("p"); original.textContent = record.message;
            article.append(head, original);
            if (record.reply) { var answer = document.createElement("blockquote"); answer.textContent = record.reply; article.appendChild(answer); }
            replyList.appendChild(article);
          }).catch(function () {});
      });
    }

    messageInput.addEventListener("input", function () {
      count.textContent = String(messageInput.value.length);
    });

    feedbackForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!feedbackForm.reportValidity()) return;

      var formData = new FormData(feedbackForm);
      var payload = {
        category: formData.get("category"),
        message: formData.get("message"),
        website: formData.get("website"),
      };

      submitButton.disabled = true;
      status.className = "form-status";
      status.textContent = "正在提交……";

      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.message || "提交失败，请稍后再试。");
          return data;
        });
      }).then(function (data) {
        if (data.ticket && data.reply_key) saveReceipt(data.ticket, data.reply_key);
        feedbackForm.reset();
        count.textContent = "0";
        status.className = "form-status success";
        status.textContent = data.message || "反馈已提交，谢谢。";
        loadReplies();
      }).catch(function (error) {
        status.className = "form-status error";
        status.textContent = error.message || "提交失败，请稍后再试。";
      }).finally(function () {
        submitButton.disabled = false;
      });
    });
    feedbackForm.querySelector("[data-refresh-replies]").addEventListener("click", loadReplies);
    loadReplies();
  }

  var publicFeedbackList = document.querySelector("[data-public-feedback-list]");
  if (publicFeedbackList) {
    var publicFeedbackPage = 1;
    var publicFeedbackMore = document.querySelector("[data-public-feedback-more]");
    function loadPublicFeedback(append) {
      fetch("/api/feedback/public?page=" + publicFeedbackPage, { cache: "no-store" }).then(function (response) {
        if (!response.ok) throw new Error(); return response.json();
      }).then(function (data) {
        document.querySelector("[data-public-feedback-count]").textContent = data.count + " 条";
        if (!append) publicFeedbackList.textContent = "";
        if (!data.feedback.length && !append) publicFeedbackList.innerHTML = "<p>还没有公开反馈。</p>";
        data.feedback.forEach(function (record) {
          var article = document.createElement("article"); article.className = "public-feedback-card";
          var head = document.createElement("header");
          var category = document.createElement("strong"); category.textContent = record.category;
          var time = document.createElement("time"); time.textContent = new Date(record.created_at).toLocaleString("zh-CN");
          head.append(category, time);
          var message = document.createElement("p"); message.textContent = record.message;
          article.append(head, message);
          if (record.reply) { var reply = document.createElement("blockquote"); reply.textContent = "站长回复：" + record.reply; article.appendChild(reply); }
          publicFeedbackList.appendChild(article);
        });
        publicFeedbackMore.hidden = !data.has_next;
      }).catch(function () { if (!append) publicFeedbackList.innerHTML = "<p>反馈历史暂时无法读取。</p>"; });
    }
    publicFeedbackMore.addEventListener("click", function () { publicFeedbackPage += 1; loadPublicFeedback(true); });
    loadPublicFeedback(false);
  }

  var revealTargets = document.querySelectorAll(".content-section, .resources-section .section-shell, .campus-promo-inner, .feedback-layout, .more-section");
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    revealTargets.forEach(function (target) { target.classList.add("reveal"); });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealTargets.forEach(function (target) { observer.observe(target); });
  }
})();
