// If the studio's code fails before it draws anything, say why in the window instead of leaving it blank
// (a release build has no developer tools to look in).
(function () {
  function show(what) {
    var app = document.getElementById("app");
    if (!app || app.childElementCount > 0) return;
    var box = document.createElement("pre");
    box.style.cssText = "margin:48px;padding:16px;color:#f4f1ea;background:#2a1b1b;border:1px solid #a33;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap";
    box.textContent = "Nova Studio could not start.\n\n" + what;
    app.appendChild(box);
  }
  window.addEventListener("error", function (e) {
    show((e.error && e.error.stack) || e.message + " (" + e.filename + ":" + e.lineno + ")");
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    show((r && r.stack) || String(r));
  });
  // a script that fails to load (a missing or refused file) does not reach window.onerror; it is caught here
  window.addEventListener(
    "error",
    function (e) {
      var t = e.target;
      if (t && t !== window && (t.src || t.href)) show("A file of the studio did not load: " + (t.src || t.href));
    },
    true,
  );
  // nothing drawn and nothing thrown: the studio's code is still waiting for something
  setTimeout(function () {
    show("Nothing was drawn 8 seconds after the window opened, and no error was reported. The studio's code is waiting for something that has not answered.");
  }, 8000);
})();
