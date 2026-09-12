window.__ModuleLoader__.load({ id: "dsh-balance", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var name = "dsh-balance";
var inject = ["slots"];
var SLOT_ID = "balance";
var POLL_INTERVAL_MS = 6e4;
var ENDPOINT = "/api/dsh/balance";
var LOW_BALANCE_THRESHOLD = 5;
var LINE_STYLE = {
  display: "block",
  textAlign: "center",
  maxWidth: "var(--dsh-chat-content-width)",
  width: "100%",
  margin: "0 auto",
  boxSizing: "border-box",
  padding: "0 calc(var(--dsh-composer-side-clearance) + 16px) 2px",
  fontSize: 12,
  lineHeight: "20px",
  color: "var(--dsw-alias-label-tertiary)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis"
};
function currencySymbol(currency) {
  if (currency === "CNY") return "\xA5";
  if (currency === "USD") return "$";
  return `${currency} `;
}
function formatAmount(raw) {
  if (raw === void 0 || raw === "") return "--";
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return String(Math.round(value * 100) / 100);
}
function formatTime(at) {
  if (at === void 0) return "";
  const date = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function tooltipFor(payload, symbol) {
  const lines = [
    "DeepSeek \u5B98\u65B9\u8D26\u6237\u4F59\u989D",
    `\u603B\u4F59\u989D ${symbol}${formatAmount(payload.total)}(\u5145\u503C ${symbol}${formatAmount(payload.toppedUp)} / \u8D60\u9001 ${symbol}${formatAmount(payload.granted)})`
  ];
  const at = formatTime(payload.fetchedAt);
  if (at !== "") lines.push(`\u66F4\u65B0\u4E8E ${at}`);
  if (payload.stale === true) lines.push(`\u4E0A\u6E38\u67E5\u8BE2\u5931\u8D25(${payload.error ?? "unknown"}),\u663E\u793A\u7684\u662F\u6700\u8FD1\u4E00\u6B21\u6210\u529F\u503C`);
  return lines.join("\n");
}
var BalanceLine = import_react.default.memo(function BalanceLine2() {
  const [payload, setPayload] = import_react.default.useState(null);
  import_react.default.useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch(ENDPOINT, {
          credentials: "same-origin",
          headers: { accept: "application/json" }
        });
        const body = await response.json();
        if (alive) setPayload(body);
      } catch {
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  if (payload === null || payload.ok !== true || payload.available === false) {
    if (payload !== null && payload.available === false) {
      return el("div", { style: { ...LINE_STYLE, color: "var(--dsw-alias-label-tertiary)" }, "data-dsh-balance": "unavailable" }, "DeepSeek \u4F59\u989D\u4E0D\u53EF\u7528");
    }
    return null;
  }
  const currency = payload.currency ?? "CNY";
  const symbol = currencySymbol(currency);
  const totalText = formatAmount(payload.total);
  const low = Number(payload.total) <= LOW_BALANCE_THRESHOLD;
  const style = { ...LINE_STYLE };
  if (payload.stale === true) style.color = "var(--dsw-alias-label-secondary, inherit)";
  if (low) style.color = "var(--dsw-alias-label-warning, inherit)";
  const suffix = payload.stale === true ? " \xB7 \u7F13\u5B58" : "";
  return el(
    "div",
    {
      style,
      title: tooltipFor(payload, symbol),
      "data-dsh-balance": payload.stale === true ? "stale" : "fresh"
    },
    `DeepSeek \u4F59\u989D ${symbol}${totalText}${suffix}`
  );
});
function el(type, props, ...children) {
  return import_react.default.createElement(type, props, ...children);
}
function apply(ctx) {
  const slots = ctx.get("slots");
  if (slots === void 0) return;
  slots.inject(
    "conversation.composer.dock",
    () => slots.register(
      {
        name: "conversation.composer.dock",
        id: SLOT_ID,
        order: 100,
        label: "DeepSeek \u4F59\u989D"
      },
      BalanceLine
    )
  );
}
return module.exports; } });
