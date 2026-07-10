(function () {
  if (window.lucide) {
    window.lucide.createIcons({ strokeWidth: 1.8 });
  }

  var searchForm = document.querySelector("[data-campus-search]");
  if (searchForm) {
    searchForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var query = new FormData(searchForm).get("q").trim();
      if (query) window.location.href = "resources.html?q=" + encodeURIComponent(query);
    });
  }
})();
