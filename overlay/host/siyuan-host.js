/* SiYuan host shim for the unmodified Analog Canvas desktop bundle.
 * It intercepts the editor's /desktop/* file bridge and forwards each call to
 * the SiYuan plugin with postMessage. No upstream source file is patched. */
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var initialAsset = params.get("asset") || null;
  var currentAsset = initialAsset;
  var insertFlag = params.get("insert") === "1";
  var updateFlag = params.get("update") === "1";
  var exportFormat = params.get("format") === "svg" ? "svg" : "png";
  var zh = params.get("lang") === "zh";
  var autosaveEnabled = params.get("autosave") !== "0";
  var scale = Number(params.get("scale"));
  if (Number.isFinite(scale) && scale >= 1 && scale <= 8) {
    window.__acExportScale = scale;
  }
  var launched = false;
  var requestSeq = 0;
  var pending = new Map();
  var saveWaiters = [];
  var autoSaveRequested = false;
  var autoSavePending = 0;
  var lastDirty = null;
  var RPC_TIMEOUT = 15 * 60 * 1000;
  var exportIntent = "export";
  var exportIntentTimer = 0;

  function setExportIntent(intent) {
    exportIntent = intent;
    window.clearTimeout(exportIntentTimer);
    exportIntentTimer = window.setTimeout(function () {
      exportIntent = "export";
    }, 60000);
  }

  function rpc(method, payload) {
    return new Promise(function (resolve, reject) {
      var id = String(++requestSeq) + ":" + Math.random().toString(36).slice(2);
      var timer = window.setTimeout(function () {
        if (pending.delete(id)) reject(new Error("SiYuan host timeout: " + method));
      }, RPC_TIMEOUT);
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
      var autosave = autoSaveRequested;
      autoSaveRequested = false;
      var saved = await rpc("saveProject", {
        // A null binding means this editor tab is a new project. Using the
        // iframe-level currentAsset here would overwrite the project that was
        // originally opened in this tab.
        asset: binding,
        text: String(payload.text || ""),
        name: name,
        saveAs: saveAs,
        autosave: autosave,
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
      await rpc("libraryAction", actionBody);
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
      var mediaType = header(init, "content-type") || "application/octet-stream";
      var format = /svg/iu.test(mediaType) || /\.svg$/iu.test(exportName) ? "svg" : "png";
      var bytes = await bodyBytes(init);
      var intent = exportIntent;
      exportIntent = "export";
      window.clearTimeout(exportIntentTimer);
      var exported = await rpc("saveExport", {
        asset: currentAsset,
        name: exportName,
        mediaType: mediaType,
        base64: toBase64(bytes),
        intent: intent,
      });
      if (exported && exported.status === "saved") {
        window.dispatchEvent(
          new CustomEvent("ac-export-done", { detail: { intent: intent, format: format } }),
        );
        return json({ status: "saved", path: exported.path });
      }
      window.dispatchEvent(
        new CustomEvent("ac-export-cancelled", { detail: { intent: intent, format: format } }),
      );
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
    // The insert/update flow counts as a manual save for snapshot policy.
    autoSaveRequested = false;
    var waiter = waitForSave(12000);
    save.click();
    return waiter;
  }

  function clickExport(format, intent) {
    return (async function () {
      setExportIntent(intent || "export");
      var saved = await saveBeforeExport();
      if (!saved) {
        setExportIntent("export");
        return false;
      }
      var details = openFileMenu();
      if (!details) {
        setExportIntent("export");
        return false;
      }
      await delay(180);
      var exportButton = Array.prototype.slice
        .call(document.querySelectorAll("button"))
        .find(function (button) {
          return (button.textContent || "").trim().indexOf("Export") === 0 && visible(button);
        });
      if (!exportButton) {
        setExportIntent("export");
        return false;
      }
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

  function isDirty() {
    return Boolean(document.querySelector('[data-testid="project-unsaved-indicator"]'));
  }

  function isTyping() {
    var element = document.activeElement;
    if (!element) return false;
    var tag = (element.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || element.isContentEditable === true;
  }

  function reportDirty() {
    var dirty = isDirty();
    if (dirty === lastDirty) return;
    lastDirty = dirty;
    parent.postMessage(
      {
        __ac: 1,
        type: "event",
        event: "dirty",
        payload: { asset: initialAsset || currentAsset, dirty: dirty },
      },
      location.origin,
    );
  }

  function hasProjectBinding() {
    var location = document.querySelector('[data-testid="native-file-location"]');
    return !location || Boolean(location.getAttribute("title"));
  }

  function dispatchSave(force) {
    if (!isDirty()) return false;
    var typing = isTyping();
    if (!force && typing) return false;
    // An unsaved "New Project" has no library path yet; a save would open the
    // Save As name prompt, which autosave must not trigger by itself.
    if (!force && !hasProjectBinding()) return false;
    if (!force && document.querySelector(".command-menu[open]")) return false;
    if (!force && autoSavePending && Date.now() - autoSavePending < 30000) return false;
    autoSavePending = Date.now();
    autoSaveRequested = true;
    if (force && typing) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    window.setTimeout(
      function () {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "s",
            code: "KeyS",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      force && typing ? 80 : 0,
    );
    window.setTimeout(function () {
      autoSavePending = 0;
    }, 15000);
    window.setTimeout(function () {
      autoSaveRequested = false;
    }, 20000);
    return true;
  }

  function startAutosave() {
    reportDirty();
    window.setInterval(reportDirty, 1500);
    window.setInterval(function () {
      if (autosaveEnabled) dispatchSave(false);
    }, 15000);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && autosaveEnabled) dispatchSave(false);
    });
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== location.origin) return;
    var message = event.data;
    if (!message || message.__ac !== 1 || message.type !== "event") return;
    if (message.event === "save") dispatchSave(true);
  });

  window.addEventListener(
    "keydown",
    function (event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if ((event.key || "").toLowerCase() !== "w") return;
      event.preventDefault();
      event.stopPropagation();
      parent.postMessage(
        {
          __ac: 1,
          type: "event",
          event: "request-close",
          payload: { asset: initialAsset || currentAsset },
        },
        location.origin,
      );
    },
    true,
  );

  function actionStyle(primary) {
    return (
      "padding:9px 16px;border-radius:999px;font:600 13px/1.2 -apple-system,BlinkMacSystemFont," +
      '"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap;' +
      (primary
        ? "border:0;background:#2f81f7;color:#fff;box-shadow:0 6px 20px rgba(31,111,235,.38);"
        : "border:1px solid rgba(47,129,247,.42);background:rgba(255,255,255,.97);color:#1f5fbf;")
    );
  }

  var insertButton = null;
  var insertBusy = false;
  var toastTimer = 0;

  function showToast(message) {
    var toast = document.getElementById("ac-circuit-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ac-circuit-toast";
      toast.style.cssText =
        "position:fixed;left:50%;bottom:112px;transform:translateX(-50%);z-index:2147483001;" +
        'max-width:min(560px,86vw);padding:9px 14px;border-radius:8px;background:rgba(28,30,33,.94);color:#fff;' +
        'font:500 12.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;' +
        "box-shadow:0 8px 24px rgba(0,0,0,.24);opacity:0;pointer-events:none;transition:opacity .16s ease;";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = "1";
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.style.opacity = "0";
    }, 4200);
  }

  function circuitTarget() {
    return (
      document.querySelector('[data-testid="schematic-canvas"]') ||
      document.querySelector('[aria-label="Schematic canvas"]') ||
      document.querySelector("main")
    );
  }

  function pasteEnvelope(target, text) {
    var data = new DataTransfer();
    data.setData("text/plain", text);
    try {
      data.setData("application/x-analog-canvas+json", text);
    } catch (_error) {
      /* text/plain is sufficient for the editor's paste handler */
    }
    var event;
    try {
      event = new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
    } catch (_error) {
      event = new Event("paste", { bubbles: true, cancelable: true });
      try {
        Object.defineProperty(event, "clipboardData", { value: data });
      } catch (_error2) {
        return false;
      }
    }
    target.dispatchEvent(event);
    return event.defaultPrevented === true;
  }

  function insertCircuitText(text) {
    if (!text || text.indexOf('"analog-canvas/clipboard"') === -1) return false;
    try {
      window.getSelection().removeAllRanges();
    } catch (_error) {
      /* No selection to clear. */
    }
    var targets = [circuitTarget(), document.body, window];
    for (var index = 0; index < targets.length; index++) {
      var target = targets[index];
      if (!target) continue;
      try {
        if (target.focus) target.focus();
      } catch (_error) {
        /* Canvas focus is best-effort. */
      }
      if (pasteEnvelope(target, text)) return true;
    }
    return false;
  }

  function insertFromClipboard() {
    if (insertBusy) return;
    insertBusy = true;
    var button = insertButton;
    var idle = button ? button.getAttribute("data-idle") || button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = zh ? "读取剪贴板…" : "Reading clipboard…";
    }
    rpc("readCircuitClipboard", {})
      .then(function (result) {
        if (!result || result.status !== "ok" || !result.text) {
          if (button) button.textContent = zh ? "剪贴板里没有电路" : "No circuit in clipboard";
          showToast(
            zh
              ? "请先在在线图库中打开电路，按 Ctrl/Cmd+A 全选、Ctrl/Cmd+C 复制。"
              : "Open a circuit in the online gallery and copy it with Ctrl/Cmd+A, Ctrl/Cmd+C.",
          );
          window.setTimeout(function () {
            if (button) {
              button.textContent = idle;
              button.disabled = false;
            }
            insertBusy = false;
          }, 3600);
          return;
        }
        var pasted = insertCircuitText(result.text);
        if (button) {
          button.textContent = pasted
            ? zh
              ? "点击画布放置"
              : "Click canvas to place"
            : zh
              ? "请直接按 Ctrl/Cmd+V"
              : "Press Ctrl/Cmd+V";
        }
        showToast(
          pasted
            ? zh
              ? "已载入电路：移动鼠标选位置，点击画布放置，Esc 取消。"
              : "Circuit loaded: move the pointer, click the canvas to place, Esc cancels."
            : zh
              ? "无法自动插入，请在画布中按 Ctrl/Cmd+V。"
              : "Could not insert automatically; press Ctrl/Cmd+V on the canvas.",
        );
        window.setTimeout(function () {
          if (button) {
            button.textContent = idle;
            button.disabled = false;
          }
          insertBusy = false;
        }, pasted ? 4200 : 3600);
      })
      .catch(function () {
        if (button) {
          button.textContent = zh ? "读取剪贴板失败" : "Clipboard unavailable";
        }
        showToast(
          zh
            ? "读取剪贴板失败，请在画布中直接按 Ctrl/Cmd+V。"
            : "Could not read the clipboard; press Ctrl/Cmd+V on the canvas.",
        );
        window.setTimeout(function () {
          if (button) {
            button.textContent = idle;
            button.disabled = false;
          }
          insertBusy = false;
        }, 3600);
      });
  }

  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    var tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      target.isContentEditable === true ||
      Boolean(
        target.closest &&
          target.closest('[contenteditable="true"], .cm-editor, [role="textbox"]'),
      )
    );
  }

  function addNoteButton() {
    var bar = document.createElement("div");
    bar.style.cssText =
      "position:fixed;left:50%;bottom:46px;transform:translateX(-50%);z-index:2147483000;" +
      "display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;";
    var busyText = zh ? "正在导出…" : "Exporting…";
    var failedText = zh ? "请手动 File → Export" : "Use File → Export manually";
    var actions = [];
    var active = null;

    function reset(action) {
      window.clearTimeout(action.resetTimer);
      action.button.textContent = action.idle;
      action.button.disabled = false;
      if (active === action) active = null;
      setEnabled(true);
    }

    function setEnabled(enabled) {
      actions.forEach(function (action) {
        action.button.disabled = !enabled;
      });
    }

    function start(action, format, intent) {
      if (active) return;
      active = action;
      setEnabled(false);
      window.clearTimeout(action.resetTimer);
      action.button.textContent = busyText;
      clickExport(format, intent)
        .then(function (ok) {
          if (!ok) {
            action.button.textContent = failedText;
            action.resetTimer = window.setTimeout(function () {
              reset(action);
            }, 3000);
            return;
          }
          action.resetTimer = window.setTimeout(function () {
            reset(action);
          }, 18000);
        })
        .catch(function () {
          action.button.textContent = failedText;
          action.resetTimer = window.setTimeout(function () {
            reset(action);
          }, 3000);
        });
    }

    function addAction(idle, format, intent, primary) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = idle;
      button.style.cssText = actionStyle(primary);
      var action = { button: button, idle: idle, format: format, intent: intent, resetTimer: 0 };
      button.addEventListener("click", function () {
        start(action, format, intent);
      });
      actions.push(action);
      bar.appendChild(button);
      return action;
    }

    if (insertFlag || updateFlag) {
      addAction(
        insertFlag ? (zh ? "插入到笔记" : "Insert into note") : zh ? "更新笔记图片" : "Update note image",
        exportFormat,
        "insert",
        true,
      );
      addAction(zh ? "复制 PNG" : "Copy PNG", "png", "clipboard", false);
      addAction(zh ? "复制 SVG" : "Copy SVG", "svg", "clipboard", false);
    }

    var insert = document.createElement("button");
    insert.type = "button";
    insert.textContent = zh ? "插入电路" : "Insert circuit";
    insert.title = zh
      ? "从剪贴板插入在线图库中复制的电路"
      : "Insert a circuit copied from the online gallery";
    insert.setAttribute("data-idle", insert.textContent);
    insert.style.cssText = actionStyle(!insertFlag && !updateFlag);
    insert.addEventListener("click", insertFromClipboard);
    insertButton = insert;
    bar.appendChild(insert);

    var gallery = document.createElement("button");
    gallery.type = "button";
    gallery.textContent = zh ? "在线图库" : "Online gallery";
    gallery.title = zh
      ? "浏览在线图库；登录后打开电路并复制"
      : "Browse the online gallery; sign in, open a circuit and copy it";
    gallery.style.cssText = actionStyle(false);
    gallery.addEventListener("click", function () {
      parent.postMessage(
        { __ac: 1, type: "event", event: "open-gallery" },
        location.origin,
      );
    });
    bar.appendChild(gallery);

    window.addEventListener(
      "keydown",
      function (event) {
        if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
        if ((event.key || "").toLowerCase() !== "v") return;
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        insertFromClipboard();
      },
      true,
    );

    window.addEventListener("ac-export-done", function (event) {
      if (!active) return;
      var detail = event.detail || {};
      if (detail.intent !== active.intent || detail.format !== active.format) return;
      window.clearTimeout(active.resetTimer);
      active.button.textContent = active.intent === "clipboard" ? (zh ? "已复制" : "Copied") : zh ? "已导出" : "Exported";
      setEnabled(false);
      var done = active;
      done.resetTimer = window.setTimeout(function () {
        reset(done);
      }, 2200);
    });
    window.addEventListener("ac-export-cancelled", function (event) {
      if (!active) return;
      var detail = event.detail || {};
      if (detail.intent !== active.intent || detail.format !== active.format) return;
      reset(active);
    });
    document.body.appendChild(bar);
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
        startAutosave();
      },
      { once: true },
    );
  } else {
    observeTitle();
    addNoteButton();
    startAutosave();
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
