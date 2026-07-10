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
        feedbackForm.reset();
        count.textContent = "0";
        status.className = "form-status success";
        status.textContent = data.message || "反馈已提交，谢谢。";
      }).catch(function (error) {
        status.className = "form-status error";
        status.textContent = error.message || "提交失败，请稍后再试。";
      }).finally(function () {
        submitButton.disabled = false;
      });
    });
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
