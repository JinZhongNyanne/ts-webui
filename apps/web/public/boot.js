/*
 * Boot guard: a classic script that runs before the app bundle, so it still
 * works when the bundle cannot load at all.
 *
 * A page restored from the browser cache after an update asks for the
 * previous build's scripts, which are gone. Without this the user sees a
 * blank page until a hard reload. Here: if a script or stylesheet fails to
 * load, or the app has not started within BOOT_TIMEOUT_MS, reload once; if
 * that did not help either, say what to do instead of staying blank.
 *
 * Plain ES5, no module, no dependencies: it has to work in the one situation
 * where nothing else does.
 */
(function () {
  var KEY = "jinz.bootReloadAt";
  var BOOT_TIMEOUT_MS = 20000;
  /* One automatic reload per this window, so a real outage cannot loop. */
  var RETRY_WINDOW_MS = 60000;
  var handled = false;

  function lastReload() {
    try {
      return Number(sessionStorage.getItem(KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function showHelp() {
    var root = document.getElementById("app");
    if (!root || root.childElementCount > 0) return;
    var box = document.createElement("div");
    box.setAttribute(
      "style",
      "font:14px/1.6 system-ui,sans-serif;color:#ccc;background:#111;padding:32px;text-align:center",
    );
    box.textContent =
      "页面没能完整加载，请按 Ctrl+Shift+R（Mac：Cmd+Shift+R）强制刷新。" +
      " The page did not load completely. Press Ctrl+Shift+R (Cmd+Shift+R on a Mac) to reload it.";
    root.appendChild(box);
  }

  function recover() {
    if (handled || window.__jinzBooted) return;
    handled = true;
    if (Date.now() - lastReload() > RETRY_WINDOW_MS) {
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch (e) {
        /* Without storage we cannot tell a loop apart: show the help instead. */
        showHelp();
        return;
      }
      location.reload();
      return;
    }
    showHelp();
  }

  window.addEventListener(
    "error",
    function (ev) {
      var el = ev.target;
      if (!el || !el.tagName) return;
      var failedScript = el.tagName === "SCRIPT";
      var failedStyle = el.tagName === "LINK" && /stylesheet|modulepreload/.test(el.rel || "");
      if (failedScript || failedStyle) recover();
    },
    true,
  );
  setTimeout(recover, BOOT_TIMEOUT_MS);
})();
