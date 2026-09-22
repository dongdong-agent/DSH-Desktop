window.__ModuleLoader__.load({ id: "dsh-tauri-dir-picker", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var name = "dsh-tauri-dir-picker";
var inject = ["slots", "uiWorkspace"];
var LAST_PATH_KEY = "dsh-tauri-dir-picker:lastPath";
function tauriInvoke() {
  const t = window.__TAURI__;
  return typeof t?.core?.invoke === "function" ? t.core.invoke : null;
}
async function nativePick(invoke) {
  let defaultPath;
  try {
    defaultPath = localStorage.getItem(LAST_PATH_KEY) ?? void 0;
  } catch {
    defaultPath = void 0;
  }
  const picked = await invoke("plugin:dialog|open", {
    options: { directory: true, multiple: false, title: "\u9009\u62E9\u5DE5\u4F5C\u533A\u76EE\u5F55", defaultPath }
  });
  return typeof picked === "string" && picked !== "" ? picked : null;
}
function TauriDirectoryFlow(props) {
  const [fallbackReason, setFallbackReason] = (0, import_react.useState)(null);
  const armed = (0, import_react.useRef)(false);
  const outcome = (0, import_react.useRef)(props);
  outcome.current = props;
  const alive = (0, import_react.useRef)(true);
  (0, import_react.useEffect)(() => () => {
    alive.current = false;
  }, []);
  (0, import_react.useEffect)(() => {
    if (!props.open) {
      armed.current = false;
      setFallbackReason(null);
      return;
    }
    if (armed.current) return;
    armed.current = true;
    const invoke = tauriInvoke();
    if (invoke === null) {
      setFallbackReason("");
      return;
    }
    nativePick(invoke).then(
      (path) => {
        if (!alive.current) return;
        if (path === null) {
          outcome.current.onCancel();
          return;
        }
        try {
          localStorage.setItem(LAST_PATH_KEY, path);
        } catch {
        }
        outcome.current.onPicked(path);
      },
      (reason) => {
        if (alive.current) setFallbackReason(String(reason?.message ?? reason));
      }
    );
  }, [props.open]);
  if (!props.open || fallbackReason === null) return null;
  return /* @__PURE__ */ import_react.default.createElement(FallbackBrowser, { ...props, tauriError: fallbackReason });
}
var OVERLAY_STYLE = {
  position: "fixed",
  inset: 0,
  zIndex: 1e3,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,.45)"
};
var CARD_STYLE = {
  width: 560,
  maxWidth: "92vw",
  maxHeight: "80dvh",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "16px 18px",
  borderRadius: 12,
  background: "var(--dsw-alias-bg-layer-2, #fff)",
  color: "var(--dsw-alias-label-primary, #111)",
  boxShadow: "0 12px 48px rgba(0,0,0,.35)",
  fontSize: 13
};
var LIST_STYLE = {
  flex: 1,
  minHeight: 120,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 2
};
var ROW_STYLE = {
  textAlign: "left",
  border: "none",
  borderRadius: 6,
  padding: "5px 8px",
  cursor: "pointer",
  background: "transparent",
  color: "inherit",
  fontSize: 13,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis"
};
var INPUT_STYLE = {
  boxSizing: "border-box",
  width: "100%",
  height: 28,
  padding: "0 8px",
  borderRadius: 6,
  border: "1px solid var(--dsw-alias-border-l2, #bbb)",
  background: "transparent",
  color: "inherit",
  fontSize: 13
};
function FallbackBrowser(props) {
  const { open, busy, onPicked, onCancel, listDirectory, createDirectory, tauriError } = props;
  const [level, setLevel] = (0, import_react.useState)(null);
  const [selected, setSelected] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(tauriError || null);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [showHidden, setShowHidden] = (0, import_react.useState)(false);
  const [folderName, setFolderName] = (0, import_react.useState)(null);
  const [pathDraft, setPathDraft] = (0, import_react.useState)(null);
  const seq = (0, import_react.useRef)(0);
  const navigate = (0, import_react.useCallback)((path) => {
    const my = ++seq.current;
    setLoading(true);
    listDirectory(path).then(
      (next) => {
        if (my !== seq.current) return;
        setLevel(next);
        setSelected(null);
        setPathDraft(null);
        setLoading(false);
        setError(null);
      },
      (reason) => {
        if (my !== seq.current) return;
        setLoading(false);
        setError(String(reason?.message ?? reason));
      }
    );
  }, [listDirectory]);
  (0, import_react.useEffect)(() => {
    if (open) navigate(void 0);
    else seq.current++;
  }, [open, navigate]);
  if (!open) return null;
  const targetPath = selected?.path ?? level?.path ?? null;
  const entries = (level?.entries ?? []).filter((e) => showHidden || !e.hidden);
  const confirmCreate = () => {
    const parent = selected?.path ?? level?.path;
    const name2 = (folderName ?? "").trim();
    if (parent === void 0 || name2 === "" || busy) return;
    createDirectory(parent, name2).then(
      () => {
        setFolderName(null);
        navigate(parent);
      },
      (reason) => setError(String(reason?.message ?? reason))
    );
  };
  return /* @__PURE__ */ import_react.default.createElement("div", { style: OVERLAY_STYLE, role: "dialog", "aria-label": "\u9009\u62E9\u5DE5\u4F5C\u533A\u76EE\u5F55" }, /* @__PURE__ */ import_react.default.createElement("div", { style: CARD_STYLE }, /* @__PURE__ */ import_react.default.createElement("div", { style: { fontSize: 15, fontWeight: 600 } }, "\u9009\u62E9\u5DE5\u4F5C\u533A\u76EE\u5F55"), /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ import_react.default.createElement("span", { style: { flexShrink: 0 } }, "\u8DEF\u5F84"), /* @__PURE__ */ import_react.default.createElement(
    "input",
    {
      style: INPUT_STYLE,
      value: pathDraft ?? selected?.path ?? level?.path ?? "",
      disabled: busy,
      spellCheck: false,
      onKeyDown: (e) => {
        if (e.key === "Enter") navigate(e.target.value.trim() || void 0);
      },
      onChange: (e) => setPathDraft(e.target.value)
    }
  )), /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" } }, (level?.crumbs ?? []).map((crumb) => /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      key: crumb.path,
      type: "button",
      style: { ...ROW_STYLE, width: "auto", padding: "2px 6px" },
      disabled: busy,
      onClick: () => navigate(crumb.path)
    },
    crumb.name
  ))), /* @__PURE__ */ import_react.default.createElement("div", { style: LIST_STYLE, role: "list" }, entries.map((entry) => /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      key: entry.path,
      type: "button",
      role: "listitem",
      style: {
        ...ROW_STYLE,
        background: entry.path === selected?.path ? "var(--dsw-alias-interactive-bg-active, #e0e7ff)" : "transparent"
      },
      disabled: busy,
      onClick: () => setSelected(entry),
      onDoubleClick: () => navigate(entry.path),
      title: entry.path
    },
    "\u{1F4C1} ",
    entry.name
  )), !loading && entries.length === 0 && /* @__PURE__ */ import_react.default.createElement("div", { style: { padding: 8, opacity: 0.6 } }, "\uFF08\u6CA1\u6709\u5B50\u76EE\u5F55\uFF09"), loading && /* @__PURE__ */ import_react.default.createElement("div", { style: { padding: 8, opacity: 0.6 } }, "\u52A0\u8F7D\u4E2D\u2026"), level?.truncated === true && /* @__PURE__ */ import_react.default.createElement("div", { style: { padding: "4px 8px", opacity: 0.6 } }, "\u6587\u4EF6\u5939\u8FC7\u591A\uFF0C\u4EC5\u663E\u793A\u5F00\u5934\u90E8\u5206\u3002")), error !== null && /* @__PURE__ */ import_react.default.createElement("div", { style: { color: "var(--dsw-alias-state-error-primary, #c00)" } }, error), folderName !== null && /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ import_react.default.createElement(
    "input",
    {
      style: INPUT_STYLE,
      autoFocus: true,
      placeholder: "\u65B0\u6587\u4EF6\u5939\u540D\u79F0",
      value: folderName,
      onChange: (e) => setFolderName(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter") confirmCreate();
        if (e.key === "Escape") setFolderName(null);
      }
    }
  ), /* @__PURE__ */ import_react.default.createElement("button", { type: "button", style: { ...ROW_STYLE, width: "auto" }, disabled: busy || folderName.trim() === "", onClick: confirmCreate }, "\u521B\u5EFA"), /* @__PURE__ */ import_react.default.createElement("button", { type: "button", style: { ...ROW_STYLE, width: "auto" }, onClick: () => setFolderName(null) }, "\u53D6\u6D88")), /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ import_react.default.createElement("button", { type: "button", style: { ...ROW_STYLE, width: "auto" }, disabled: busy || level === null, onClick: () => setFolderName("") }, "\u65B0\u5EFA\u6587\u4EF6\u5939"), /* @__PURE__ */ import_react.default.createElement("button", { type: "button", style: { ...ROW_STYLE, width: "auto" }, disabled: busy, "aria-pressed": showHidden, onClick: () => setShowHidden((v) => !v) }, "\u663E\u793A\u9690\u85CF\u6587\u4EF6", showHidden ? " \u2713" : ""), /* @__PURE__ */ import_react.default.createElement("span", { style: { flex: 1 } }), /* @__PURE__ */ import_react.default.createElement("button", { type: "button", style: { ...ROW_STYLE, width: "auto" }, disabled: busy, onClick: onCancel }, "\u53D6\u6D88"), /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      type: "button",
      style: { ...ROW_STYLE, width: "auto", background: "var(--dsw-alias-button-info-fill, #35f)", color: "#fff" },
      disabled: busy || loading || targetPath === null,
      onClick: () => {
        if (targetPath !== null) onPicked(targetPath);
      }
    },
    "\u6253\u5F00"
  ))));
}
function apply(ctx) {
  const injected = () => ({
    listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
    createDirectory: (path, name2) => ctx.uiWorkspace.createDirectory(path, name2)
  });
  ctx.slots.inject("conversation.hero.workspace.directoryFlow", () => ctx.slots.inject("sidebar.workspaces.directoryFlow", function* () {
    yield ctx.slots.register({ name: "conversation.hero.workspace.directoryFlow", inject: injected }, TauriDirectoryFlow);
    yield ctx.slots.register({ name: "sidebar.workspaces.directoryFlow", inject: injected }, TauriDirectoryFlow);
  }));
}
return module.exports; } });
