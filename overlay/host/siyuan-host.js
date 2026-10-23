/* SiYuan host shim for the unmodified Analog Canvas desktop bundle.
 * It intercepts the editor's /desktop/* file bridge and forwards each call to
 * the SiYuan plugin with postMessage. No upstream source file is patched. */
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var currentAsset = params.get("asset") || null;
  var insertFlag = params.get("insert") === "1";
  var updateFlag = params.get("update") === "1";
  var exportFormat = params.get("format") === "svg" ? "svg" : "png";
  var zh = params.get("lang") === "zh";
  var launched = false;
  var requestSeq = 0;
  var pending = new Map();
  var saveWaiters = [];
  var exportIntent = "export";
  var exportIntentTimer = 0;

  function setExportIntent(intent) {
    exportIntent = intent;
    window.clearTimeout(exportIntentTimer);
    exportIntentTimer = window.setTimeout(function () {
      exportIntent = "export";
    }, 15000);
  }

  function rpc(method, payload) {
    return new Promise(function (resolve, reject) {
      var id = String(++requestSeq) + ":" + Math.random().toString(36).slice(2);
      var timer = window.setTimeout(function () {
        if (pending.delete(id)) reject(new Error("SiYuan host timeout: " + method));
      }, 120000);
      pending.set(id, {
        resolve: function (value) {
          window.clearTimeout(timer);
          resolve(value);
        },
        reject: function (error) {
          window.clearTimeout(timer);
          reject(error);
        },
      });
      parent.postMessage(
        { __ac: 1, type: "request", id: id, method: method, params: payload || {} },
        location.origin,
      );
    });
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== location.origin) return;
    var message = event.data;
    if (!message || message.__ac !== 1 || message.type !== "response") return;
    var entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error));
    else entry.resolve(message.result);
  });

  function json(value, status) {
    return new Response(JSON.stringify(value), {
      status: status || 200,
      headers: { "content-type": "application/json" },
    });
  }

  function header(init, name) {
    try {
      return new Headers(init && init.headers).get(name);
    } catch (_error) {
      return null;
    }
  }

  async function bodyText(init) {
    if (!init || init.body == null) return "";
    if (typeof init.body === "string") return init.body;
    if (init.body instanceof Blob) return init.body.text();
    if (init.body instanceof ArrayBuffer) return new TextDecoder().decode(init.body);
    if (ArrayBuffer.isView(init.body)) {
      return new TextDecoder().decode(init.body);
    }
    return String(init.body);
  }

  async function bodyBytes(init) {
    if (!init || init.body == null) return new Uint8Array();
    if (init.body instanceof Blob) return new Uint8Array(await init.body.arrayBuffer());
    if (init.body instanceof ArrayBuffer) return new Uint8Array(init.body);
    if (ArrayBuffer.isView(init.body)) {
      return new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength);
    }
    return new TextEncoder().encode(String(init.body));
  }

  function toBase64(bytes) {
    var binary = "";
    var chunk = 0x8000;
    for (var start = 0; start < bytes.length; start += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(start, start + chunk));
    }
    return btoa(binary);
  }

  function fileFor(asset, revision) {
    return {
      id: asset.path,
      revision: revision,
      name: asset.fileName,
      path: asset.path,
    };
  }

  async function openAsset(assetPath) {
    var result = await rpc("readAsset", { asset: assetPath });
    var name = assetPath.slice(assetPath.lastIndexOf("/") + 1);
    return {
      status: "opened",
      file: { id: assetPath, revision: Date.now(), name: name, path: assetPath },
      text: result.text,
    };
  }

  async function handleDesktop(url, init) {
    var route = url.pathname.slice("/desktop/".length);
    var method = String((init && init.method) || "GET").toUpperCase();
    var text = "";

    if (route === "project/next-launch") {
      if (currentAsset && !launched) {
        launched = true;
        return json({ status: "queued", id: currentAsset });
      }
      return json({ status: "empty" });
    }

    if (route === "project/recent") {
      var listed = await rpc("listAssets");
      var recent = (listed.assets || []).slice(0, 30).map(function (asset) {
        return { id: asset.path, name: asset.fileName, path: asset.path };
      });
      return json({ status: "done", files: recent });
    }

    if (route === "project/open") {
      var recentId = header(init, "x-recent-project");
      if (recentId) {
        var opened = await openAsset(recentId);
        currentAsset = recentId;
        return json(opened);
      }
      var picked = await rpc("pickAsset");
      if (picked && picked.status === "opened" && picked.file) currentAsset = picked.file.path;
      return json(picked);
    }

    if (route === "project/resume") {
      text = await bodyText(init);
      var resume = JSON.parse(text || "{}");
      var resumed = await openAsset(String(resume.path || ""));
      currentAsset = resumed.file.path;
      return json(resumed);
    }

    if (route === "project/save") {
      text = await bodyText(init);
      var payload = JSON.parse(text || "{}");
      var name = String(payload.name || "untitled.icproj.json");
      var saveAs = Boolean(payload.saveAs);
      if (saveAs) {
        var named = await rpc("pickSaveName", { suggestedName: name });
        if (!named || named.status === "cancelled") return json({ status: "cancelled" });
        name = String(named.name || name);
      }
      var binding = payload.binding && payload.binding.id ? String(payload.binding.id) : null;
      var saved = await rpc("saveProject", {
        // A null binding means this editor tab is a new project. Using the
        // iframe-level currentAsset here would overwrite the project that was
        // originally opened in this tab.
        asset: binding,
        text: String(payload.text || ""),
        name: name,
        saveAs: saveAs,
      });
      if (saved && saved.status === "saved" && saved.file) {
        currentAsset = saved.file.path;
        try {
          notifyTitle(JSON.parse(payload.text || "{}").name || name.replace(/\.icproj\.json$/i, ""));
        } catch (_error) {
          notifyTitle(name.replace(/\.icproj\.json$/i, ""));
        }
      }
      var saveOk = Boolean(saved && saved.status === "saved");
      var waiters = saveWaiters;
      saveWaiters = [];
      waiters.forEach(function (waiter) {
        waiter(saveOk);
      });
      return json(saved);
    }

    if (route === "project/library") {
      return json(await rpc("libraryList"));
    }

    if (route === "project/library-action") {
      text = await bodyText(init);
      var actionBody = JSON.parse(text || "{}");
      var action = String(actionBody.action || "");
      if (action === "delete" || action === "purge" || action === "rename") {
        await rpc("libraryAction", actionBody);
      }
      return json({ status: "done" });
    }

    if (route === "project/history") {
      text = await bodyText(init);
      var historyBody = JSON.parse(text || "{}");
      return json(await rpc("history", { id: historyBody.id }));
    }

    if (route === "project/saved-copy") {
      text = await bodyText(init);
      var copyBody = JSON.parse(text || "{}");
      return json(await rpc("savedCopy", { id: copyBody.id }));
    }

    if (route === "project/copy-to-library") {
      text = await bodyText(init);
      var copyToLibrary = JSON.parse(text || "{}");
      await rpc("duplicateAsset", { id: copyToLibrary.id });
      return json({ status: "done" });
    }

    if (
      route === "project/release" ||
      route === "project/forget" ||
      route === "project/reveal" ||
      route === "project/library-directory"
    ) {
      return json({ status: "done" });
    }

    if (route === "export") {
      var exportName = decodeURIComponent(header(init, "x-export-name") || "export");
      var bytes = await bodyBytes(init);
      var intent = exportIntent;
      exportIntent = "export";
      window.clearTimeout(exportIntentTimer);
      var exported = await rpc("saveExport", {
        asset: currentAsset,
        name: exportName,
        mediaType: header(init, "content-type") || "application/octet-stream",
        base64: toBase64(bytes),
        intent: intent,
      });
      if (exported && exported.status === "saved") {
        window.dispatchEvent(new CustomEvent("ac-export-done"));
        return json({ status: "saved", path: exported.path });
      }
      window.dispatchEvent(new CustomEvent("ac-export-cancelled"));
      return json({ status: "cancelled" });
    }

    if (route === "external") {
      return json({ status: "done" });
    }

    if (route.indexOf("components/") === 0) {
      if (route === "components/list") return json(await rpc("componentsList"));
      return json({ error: "Local components are not available in SiYuan." }, 503);
    }

    if (route === "system/info") {
      return json({
        status: "ready",
        info: {
          version: "SiYuan",
          commit: "siyuan-analog-canvas",
          dirty: false,
          format: 77,
          userData: "assets/analog-canvas",
          projectRoot: "assets/analog-canvas",
          packaged: true,
          migration: "Projects are stored as SiYuan assets.",
          association: { enabled: false, otherInstallation: false },
        },
      });
    }
    if (route === "system/enable" || route === "system/disable") {
      return json({ status: "ready" });
    }

    console.warn("[siyuan-analog-canvas] unhandled desktop route", method, route);
    return json({ status: "failed", message: "Unsupported host route: " + route });
  }

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    var url;
    try {
      url = new URL(raw, location.href);
    } catch (_error) {
      return nativeFetch(input, init);
    }
    if (url.origin === location.origin && url.pathname.indexOf("/desktop/") === 0) {
      return handleDesktop(url, init).catch(function (error) {
        return json({ status: "failed", message: String(error && error.message ? error.message : error) });
      });
    }
    return nativeFetch(input, init);
  };

  function notifyTitle(title) {
    if (!title) return;
    parent.postMessage(
      { __ac: 1, type: "event", event: "title", payload: { asset: currentAsset, title: title } },
      location.origin,
    );
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function visible(element) {
    var rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function fileMenu() {
    var details = document.querySelector("details.command-menu.project-menu");
    if (details) return details;
    return (
      Array.prototype.slice.call(document.querySelectorAll("details")).find(function (node) {
        var summary = node.querySelector("summary");
        return summary && (summary.textContent || "").trim() === "File";
      }) || null
    );
  }

  function openFileMenu() {
    var details = fileMenu();
    if (!details) return null;
    if (!details.open) {
      var summary = details.querySelector("summary");
      if (!summary) return null;
      summary.click();
    }
    return details;
  }

  function waitForSave(timeout) {
    return new Promise(function (resolve) {
      var timer = window.setTimeout(function () {
        resolve(false);
      }, timeout);
      saveWaiters.push(function (ok) {
        window.clearTimeout(timer);
        resolve(ok);
      });
    });
  }

  async function saveBeforeExport() {
    var details = openFileMenu();
    if (!details) return false;
    await delay(180);
    var save = Array.prototype.slice
      .call(document.querySelectorAll("button"))
      .find(function (button) {
        return (button.textContent || "").trim() === "Save" && visible(button);
      });
    if (!save) return false;
    if (save.disabled || save.getAttribute("aria-disabled") === "true") return true;
    var waiter = waitForSave(12000);
    save.click();
    return waiter;
  }

  function clickExport(format, forNote) {
    return (async function () {
      setExportIntent(forNote ? "insert" : "export");
      var saved = await saveBeforeExport();
      if (!saved) {
        setExportIntent("export");
        return false;
      }
      var details = openFileMenu();
      if (!details) return false;
      await delay(180);
      var exportButton = Array.prototype.slice
        .call(document.querySelectorAll("button"))
        .find(function (button) {
          return (button.textContent || "").trim().indexOf("Export") === 0 && visible(button);
        });
      if (!exportButton) return false;
      if (exportButton.getAttribute("aria-expanded") !== "true") {
        exportButton.click();
        await delay(180);
      }
      var label = format === "svg" ? "Drawing as SVG" : "Drawing as PNG";
      var option = Array.prototype.slice
        .call(document.querySelectorAll("button"))
        .find(function (button) {
          return (button.textContent || "").trim() === label && visible(button);
        });
      if (!option) {
        setExportIntent("export");
        return false;
      }
      option.click();
      return true;
    })();
  }

  function addNoteButton() {
    if (!insertFlag && !updateFlag) return;
    var button = document.createElement("button");
    button.type = "button";
    button.style.cssText =
      "position:fixed;left:50%;bottom:46px;transform:translateX(-50%);z-index:2147483000;" +
      "padding:9px 18px;border:0;border-radius:999px;background:#2f81f7;color:#fff;" +
      'font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      "cursor:pointer;box-shadow:0 6px 20px rgba(31,111,235,.38);";
    var idle = insertFlag
      ? zh
        ? "插入到笔记"
        : "Insert into note"
      : zh
        ? "更新笔记图片"
        : "Update note image";
    var busy = zh ? "正在导出…" : "Exporting…";
    var done = zh ? "已导出" : "Exported";
    var failed = zh ? "请手动 File → Export" : "Use File → Export manually";
    button.textContent = idle;
    var resetTimer = 0;
    function reset() {
      button.textContent = idle;
      button.disabled = false;
    }
    button.addEventListener("click", async function () {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = busy;
      try {
        var ok = await clickExport(exportFormat, true);
        if (!ok) {
          button.textContent = failed;
          window.setTimeout(reset, 3000);
          return;
        }
        window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(reset, 15000);
      } catch (_error) {
        button.textContent = failed;
        window.setTimeout(reset, 3000);
      }
    });
    window.addEventListener("ac-export-done", function () {
      window.clearTimeout(resetTimer);
      button.textContent = done;
      window.setTimeout(reset, 2200);
    });
    window.addEventListener("ac-export-cancelled", function () {
      window.clearTimeout(resetTimer);
      reset();
    });
    document.body.appendChild(button);
  }

  var lastTitle = "";
  function observeTitle() {
    var titleElement = document.querySelector("title");
    if (!titleElement) return;
    var read = function () {
      var raw = document.title || "";
      var title = raw.replace(/\s+—\s+Analog Canvas$/u, "").trim();
      if (title === "Analog Canvas") return;
      if (title && title !== lastTitle) {
        lastTitle = title;
        notifyTitle(title);
      }
    };
    new MutationObserver(read).observe(titleElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    read();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        observeTitle();
        addNoteButton();
      },
      { once: true },
    );
  } else {
    observeTitle();
    addNoteButton();
  }

  var style = document.createElement("style");
  style.textContent =
    'a[href^="https://github.com/"],a[href*="tokenzhang.com"]{display:none!important}';
  document.addEventListener(
    "DOMContentLoaded",
    function () {
      document.head.appendChild(style);
    },
    { once: true },
  );
})();
