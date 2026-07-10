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

  var revealTargets = document.querySelectorAll(".content-section, .resources-section .section-shell, .more-section");
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
