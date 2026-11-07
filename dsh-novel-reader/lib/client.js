/**
 * dsh-novel-reader browser bundle: a paginated novel reader registered as a
 * session-header action. Library persists in IndexedDB, settings and reading
 * progress in localStorage. Hotkeys are fully user-rebindable. Search goes
 * through the host's same-origin routes (no CORS); TXT import/export is
 * purely local. No LLM involvement.
 */
window.__ModuleLoader__.load({
	id: "@kingkk/dsh-novel-reader",
	factory: function (require) {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");
		var ReactDOM = require("react-dom");
		var h = React.createElement;

		// ── constants ──────────────────────────────────────────────────────
		var DB_NAME = "dsh-novel-reader";
		var DB_STORE = "novels";
		var LS_SETTINGS = "dsh-novel-reader:settings";
		var LS_PROGRESS = "dsh-novel-reader:progress";

		var DEFAULT_SETTINGS = {
			pageSize: 900,
			fontSize: 16,
			lineHeight: 1.8,
			hotkeys: {
				toggle: "alt+x",
				prevPage: "arrowleft",
				nextPage: "arrowright"
			}
		};
		var HOTKEY_LABELS = { toggle: "收起 / 展开阅读器", prevPage: "上一页", nextPage: "下一页" };

		// ── settings / progress (localStorage) ─────────────────────────────
		function loadSettings() {
			try {
				var raw = localStorage.getItem(LS_SETTINGS);
				if (raw === null) return cloneSettings(DEFAULT_SETTINGS);
				var parsed = JSON.parse(raw);
				return {
					pageSize: num(parsed.pageSize, DEFAULT_SETTINGS.pageSize),
					fontSize: num(parsed.fontSize, DEFAULT_SETTINGS.fontSize),
					lineHeight: num(parsed.lineHeight, DEFAULT_SETTINGS.lineHeight),
					hotkeys: {
						toggle: key(parsed.hotkeys && parsed.hotkeys.toggle, DEFAULT_SETTINGS.hotkeys.toggle),
						prevPage: key(parsed.hotkeys && parsed.hotkeys.prevPage, DEFAULT_SETTINGS.hotkeys.prevPage),
						nextPage: key(parsed.hotkeys && parsed.hotkeys.nextPage, DEFAULT_SETTINGS.hotkeys.nextPage)
					}
				};
			} catch (e) { return cloneSettings(DEFAULT_SETTINGS); }
		}
		function cloneSettings(s) { return JSON.parse(JSON.stringify(s)); }
		function num(v, d) { return typeof v === "number" && isFinite(v) && v > 0 ? v : d; }
		function key(v, d) { return typeof v === "string" && v.length > 0 ? v : d; }
		function saveSettings(s) { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); } catch (e) {} }

		function loadProgress() {
			try { return JSON.parse(localStorage.getItem(LS_PROGRESS) || "{}") || {}; }
			catch (e) { return {}; }
		}
		function saveProgress(p) { try { localStorage.setItem(LS_PROGRESS, JSON.stringify(p)); } catch (e) {} }
		// page may legitimately be 0, so it needs its own validator (num() rejects 0).
		function pageNum(v, d) { return typeof v === "number" && isFinite(v) && v >= 0 ? v : d; }

		// ── hotkey matching ────────────────────────────────────────────────
		// Format: "ctrl+alt+x" / "arrowleft" / "f2", all lowercase, sorted mods.
		function comboFromEvent(e) {
			var parts = [];
			if (e.ctrlKey) parts.push("ctrl");
			if (e.altKey) parts.push("alt");
			if (e.shiftKey) parts.push("shift");
			if (e.metaKey) parts.push("meta");
			var k = (e.key || "").toLowerCase();
			if (k === " ") k = "space";
			if (["control", "alt", "shift", "meta"].indexOf(k) !== -1) return null; // bare modifier
			parts.push(k);
			return parts.join("+");
		}
		function comboDisplay(combo) {
			return combo.split("+").map(function (p) {
				if (p === "ctrl") return "Ctrl";
				if (p === "alt") return "Alt";
				if (p === "shift") return "Shift";
				if (p === "meta") return "Cmd";
				if (p === "space") return "Space";
				if (p.indexOf("arrow") === 0) return { arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" }[p] || p;
				return p.length === 1 ? p.toUpperCase() : p;
			}).join(" + ");
		}
		function isTypingTarget(e) {
			var t = e.target;
			if (!t || !t.tagName) return false;
			var tag = t.tagName.toLowerCase();
			return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable === true;
		}

		// ── IndexedDB library ──────────────────────────────────────────────
		function openDb() {
			return new Promise(function (resolve, reject) {
				var req = indexedDB.open(DB_NAME, 1);
				req.onupgradeneeded = function () {
					if (!req.result.objectStoreNames.contains(DB_STORE)) {
						req.result.createObjectStore(DB_STORE, { keyPath: "id" });
					}
				};
				req.onsuccess = function () { resolve(req.result); };
				req.onerror = function () { reject(req.error); };
			});
		}
		function idbPut(novel) {
			return openDb().then(function (db) {
				return new Promise(function (resolve, reject) {
					var tx = db.transaction(DB_STORE, "readwrite");
					tx.objectStore(DB_STORE).put(novel);
					tx.oncomplete = function () { resolve(); };
					tx.onerror = function () { reject(tx.error); };
				});
			});
		}
		function idbAll() {
			return openDb().then(function (db) {
				return new Promise(function (resolve, reject) {
					var tx = db.transaction(DB_STORE, "readonly");
					var req = tx.objectStore(DB_STORE).getAll();
					req.onsuccess = function () { resolve(req.result || []); };
					req.onerror = function () { reject(req.error); };
				});
			});
		}
		function idbGet(id) {
			return openDb().then(function (db) {
				return new Promise(function (resolve, reject) {
					var tx = db.transaction(DB_STORE, "readonly");
					var req = tx.objectStore(DB_STORE).get(id);
					req.onsuccess = function () { resolve(req.result || null); };
					req.onerror = function () { reject(req.error); };
				});
			});
		}
		function idbDelete(id) {
			return openDb().then(function (db) {
				return new Promise(function (resolve, reject) {
					var tx = db.transaction(DB_STORE, "readwrite");
					tx.objectStore(DB_STORE).delete(id);
					tx.oncomplete = function () { resolve(); };
					tx.onerror = function () { reject(tx.error); };
				});
			});
		}

		// ── helpers ────────────────────────────────────────────────────────
		function uid() { return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
		function paginate(text, pageSize) {
			var pages = [];
			for (var i = 0; i < text.length; i += pageSize) pages.push(text.slice(i, i + pageSize));
			return pages.length === 0 ? [""] : pages;
		}
		function downloadText(filename, text) {
			var blob = new Blob(["﻿" + text], { type: "text/plain;charset=utf-8" });
			var url = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
		}
		function readFileAsText(file) {
			return new Promise(function (resolve, reject) {
				var reader = new FileReader();
				reader.onload = function () { resolve(String(reader.result || "")); };
				reader.onerror = function () { reject(reader.error); };
				reader.readAsText(file); // utf-8 default; gbk users can convert first
			});
		}
		function api(path, body) {
			return fetch(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body || {})
			}).then(function (r) { return r.json(); });
		}

		// ── CSS ────────────────────────────────────────────────────────────
		var CSS = [
			".nr-trigger { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; line-height: 18px; }",
			".nr-trigger:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }",
			".nr-panel { position: fixed; top: 60px; right: 16px; bottom: 16px; z-index: 230; width: 520px; max-width: calc(100vw - 32px); display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 14px 40px rgba(0,0,0,0.28); overflow: hidden; }",
			".nr-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex: none; }",
			".nr-title { font-weight: 600; color: var(--dsw-alias-label-primary); font-size: 14px; margin-right: auto; }",
			".nr-icon-btn { border: 0; background: none; color: var(--dsw-alias-label-secondary); font-size: 17px; cursor: pointer; padding: 2px 7px; border-radius: 6px; line-height: 1; }",
			".nr-icon-btn:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }",
			".nr-tabs { display: flex; gap: 4px; padding: 8px 12px 0; flex: none; }",
			".nr-tab { padding: 5px 12px; border-radius: 8px 8px 0 0; border: 1px solid transparent; border-bottom: 0; background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 13px; }",
			".nr-tab.active { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); font-weight: 600; }",
			".nr-body { flex: 1; overflow: auto; padding: 12px; background: var(--dsw-alias-bg-layer-1); border-top: 1px solid var(--dsw-alias-border-l1); }",
			".nr-row { display: flex; gap: 8px; align-items: center; }",
			".nr-input { flex: 1; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; outline: none; }",
			".nr-input:focus { border-color: var(--dsw-alias-brand-primary); }",
			".nr-btn { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 13px; white-space: nowrap; }",
			".nr-btn:hover { border-color: var(--dsw-alias-brand-primary); }",
			".nr-btn.primary { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-brand-primary); }",
			".nr-btn:disabled { opacity: 0.45; cursor: default; }",
			".nr-muted { color: var(--dsw-alias-label-secondary); font-size: 12px; }",
			".nr-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }",
			".nr-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; background: var(--dsw-alias-bg-layer-2); }",
			".nr-card-title { font-weight: 600; color: var(--dsw-alias-label-primary); font-size: 13px; }",
			".nr-card-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 2px; }",
			".nr-card-summary { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
			".nr-card-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center; }",
			".nr-dl-tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 5px; background: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-bg-base); font-size: 11px; font-weight: 400; vertical-align: middle; }",
			".nr-list-empty { text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; padding: 40px 0; }",
			// reader
			".nr-reader { display: flex; flex-direction: column; height: 100%; }",
			".nr-reader-text { flex: 1; overflow: hidden; color: var(--dsw-alias-label-primary); white-space: pre-wrap; word-break: break-word; }",
			".nr-reader-bar { flex: none; display: flex; align-items: center; gap: 8px; padding-top: 10px; margin-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1); }",
			".nr-page-info { color: var(--dsw-alias-label-secondary); font-size: 12px; margin: 0 auto; }",
			// settings
			".nr-set-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 13px; color: var(--dsw-alias-label-primary); }",
			".nr-set-label { flex: 1; }",
			".nr-keycap { min-width: 90px; text-align: center; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; font-family: inherit; }",
			".nr-keycap.recording { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }",
			".nr-range { width: 110px; }"
		].join("\n");

		// ── Search view ────────────────────────────────────────────────────
		function SearchView(props) {
			var kwState = React.useState("");
			var keyword = kwState[0], setKeyword = kwState[1];
			var busyState = React.useState(false);
			var busy = busyState[0], setBusy = busyState[1];
			var resultsState = React.useState(null);
			var results = resultsState[0], setResults = resultsState[1];
			var errState = React.useState("");
			var error = errState[0], setError = errState[1];
			var dlState = React.useState({}); // id -> { phase: 'downloading'|'done'|'error', msg }
			var downloads = dlState[0], setDownloads = dlState[1];

			function setDl(id, val) {
				setDownloads(function (prev) {
					var next = Object.assign({}, prev);
					if (val === null) delete next[id]; else next[id] = val;
					return next;
				});
			}

			function doSearch() {
				var kw = keyword.trim();
				if (kw.length === 0 || busy) return;
				setBusy(true); setError(""); setResults(null); setDownloads({});
				// 双源并发：整本下载源（可下全文）+ 元信息源（书更全），整本源结果排前
				var dlReq = api("/novel-reader/txt80-search", { keyword: kw }).catch(function () { return { ok: false, books: [] }; });
				var metaReq = api("/novel-reader/search", { keyword: kw }).catch(function () { return { ok: false, books: [] }; });
				Promise.all([dlReq, metaReq]).then(function (both) {
					setBusy(false);
					var dl = (both[0] && both[0].ok ? both[0].books : []).map(function (b) { b.sourceType = "download"; return b; });
					var meta = (both[1] && both[1].ok ? both[1].books : []).map(function (b) { b.sourceType = "meta"; return b; });
					var all = dl.concat(meta);
					if (all.length === 0 && !(both[0] && both[0].ok) && !(both[1] && both[1].ok)) {
						setError("两个书源都不可用，请检查网络");
					}
					setResults(all);
				});
			}

			function downloadFull(book) {
				if (downloads[book.id] && downloads[book.id].phase === "downloading") return;
				setDl(book.id, { phase: "downloading", msg: "下载全文中（大书需数十秒）…" });
				api("/novel-reader/download", { downPath: book.downPath }).then(function (r) {
					if (r && r.ok && r.text) {
						setDl(book.id, { phase: "done", msg: "已入库（" + Math.round(r.text.length / 1000) + " 千字）" });
						props.onAddText(book.title || "未命名", r.text, "整本下载 · " + (book.author || ""));
					} else {
						setDl(book.id, { phase: "error", msg: (r && r.error) || "下载失败" });
					}
				}).catch(function (e) {
					setDl(book.id, { phase: "error", msg: String(e && e.message || e) });
				});
			}

			var list = null;
			if (results !== null) {
				if (results.length === 0) {
					list = h("div", { className: "nr-list-empty" }, "没有找到相关小说");
				} else {
					list = results.map(function (b) {
						var dl = downloads[b.id];
						var canDownload = b.sourceType === "download" && b.downPath;
						var action;
						if (canDownload) {
							if (dl && dl.phase === "downloading") {
								action = h("span", { className: "nr-muted" }, dl.msg);
							} else if (dl && dl.phase === "done") {
								action = h("span", { className: "nr-muted" }, "✓ " + dl.msg);
							} else {
								action = h("button", { className: "nr-btn primary", onClick: function () { downloadFull(b); } }, "下载全文");
							}
						} else {
							action = h("button", { className: "nr-btn", onClick: function () { props.onImportBook(b); } }, "存为待读");
						}
						return h("div", { key: b.id, className: "nr-card" },
							h("div", { className: "nr-card-title" },
								b.title || "（无书名）",
								canDownload ? h("span", { className: "nr-dl-tag" }, "可下全文") : null),
							h("div", { className: "nr-card-meta" }, (b.author || "佚名") + (b.category ? " · " + b.category : "")),
							b.summary ? h("div", { className: "nr-card-summary" }, b.summary) : null,
							h("div", { className: "nr-card-actions" },
								action,
								dl && dl.phase === "error" ? h("span", { className: "nr-error" }, dl.msg) : null));
					});
				}
			}

			return h("div", null,
				h("div", { className: "nr-row" },
					h("input", {
						className: "nr-input",
						placeholder: "输入书名或作者搜索…",
						value: keyword,
						onChange: function (e) { setKeyword(e.target.value); },
						onKeyDown: function (e) { if (e.key === "Enter") doSearch(); }
					}),
					h("button", { className: "nr-btn primary", disabled: busy, onClick: doSearch }, busy ? "搜索中…" : "搜索")),
				error ? h("div", { className: "nr-error", style: { marginTop: "8px" } }, error) : null,
				h("div", { style: { marginTop: "10px" } },
					results === null && !busy
						? h("div", { className: "nr-list-empty" }, "输入关键词开始搜索；也可到「书库」直接导入本地 TXT")
						: list));
		}

		// ── Library view ───────────────────────────────────────────────────
		function LibraryView(props) {
			var fileRef = React.useRef(null);
			function onFile(e) {
				var file = e.target.files && e.target.files[0];
				e.target.value = "";
				if (!file) return;
				readFileAsText(file).then(function (text) {
					var name = file.name.replace(/\.txt$/i, "");
					return props.onAddText(name, text, "本地导入");
				}).catch(function () { props.onError("文件读取失败（仅支持 UTF-8 编码的 TXT）"); });
			}
			var items = props.novels.length === 0
				? h("div", { className: "nr-list-empty" }, "书库为空：去「搜索」找书，或导入本地 TXT")
				: props.novels.map(function (n) {
					return h("div", { key: n.id, className: "nr-card" },
						h("div", { className: "nr-card-title" }, n.title),
						h("div", { className: "nr-card-meta" }, (n.author ? n.author + " · " : "") + n.source + " · " + Math.round(n.text.length / 1000) + " 千字"),
						h("div", { className: "nr-card-actions" },
							h("button", { className: "nr-btn primary", onClick: function () { props.onRead(n); } }, "阅读"),
							h("button", { className: "nr-btn", onClick: function () { downloadText(n.title + ".txt", n.text); } }, "导出 TXT"),
							h("button", { className: "nr-btn", onClick: function () { props.onDelete(n); } }, "删除")));
				});
			return h("div", null,
				h("div", { className: "nr-row", style: { marginBottom: "10px" } },
					h("button", { className: "nr-btn", onClick: function () { fileRef.current && fileRef.current.click(); } }, "导入 TXT 文件"),
					h("input", { ref: fileRef, type: "file", accept: ".txt,text/plain", style: { display: "none" }, onChange: onFile }),
					h("span", { className: "nr-muted" }, "支持 UTF-8 编码的 .txt")),
				items);
		}

		// ── Reader view ────────────────────────────────────────────────────
		function ReaderView(props) {
			var n = props.novel;
			var pages = paginate(n.text, props.settings.pageSize);
			var page = Math.min(props.page, pages.length - 1);
			var style = {
				fontSize: props.settings.fontSize + "px",
				lineHeight: String(props.settings.lineHeight)
			};
			return h("div", { className: "nr-reader" },
				h("div", { className: "nr-row", style: { marginBottom: "8px", flex: "none" } },
					h("button", { className: "nr-btn", onClick: props.onBack }, "← 返回"),
					h("span", { className: "nr-card-title", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, n.title)),
				h("div", { className: "nr-reader-text", style: style }, pages[page]),
				h("div", { className: "nr-reader-bar" },
					h("button", { className: "nr-btn", disabled: page <= 0, onClick: function () { props.onPage(page - 1); } }, "上一页"),
					h("span", { className: "nr-page-info" }, (page + 1) + " / " + pages.length),
					h("button", { className: "nr-btn", disabled: page >= pages.length - 1, onClick: function () { props.onPage(page + 1); } }, "下一页")));
		}

		// ── Settings view ──────────────────────────────────────────────────
		function SettingsView(props) {
			var s = props.settings;
			var recState = React.useState(null);
			var recording = recState[0], setRecording = recState[1];

			React.useEffect(function () {
				if (recording === null) return undefined;
				function onKey(e) {
					e.preventDefault(); e.stopPropagation();
					var combo = comboFromEvent(e);
					if (combo === null) return; // wait for non-modifier
					props.onHotkey(recording, combo);
					setRecording(null);
				}
				window.addEventListener("keydown", onKey, true);
				return function () { window.removeEventListener("keydown", onKey, true); };
			}, [recording]);

			function hotkeyRow(action) {
				var isRec = recording === action;
				return h("div", { className: "nr-set-row", key: action },
					h("span", { className: "nr-set-label" }, HOTKEY_LABELS[action]),
					h("button", {
						className: "nr-keycap" + (isRec ? " recording" : ""),
						onClick: function () { setRecording(isRec ? null : action); }
					}, isRec ? "按下新快捷键…" : comboDisplay(s.hotkeys[action])));
			}

			return h("div", null,
				h("div", { className: "nr-muted", style: { marginBottom: "6px" } }, "快捷键（点击按键框后按下新组合键即可修改）"),
				hotkeyRow("toggle"), hotkeyRow("prevPage"), hotkeyRow("nextPage"),
				h("div", { className: "nr-set-row" },
					h("span", { className: "nr-set-label" }, "每页字数（" + s.pageSize + "）"),
					h("input", { className: "nr-range", type: "range", min: 300, max: 3000, step: 100, value: s.pageSize, onChange: function (e) { props.onSetting("pageSize", Number(e.target.value)); } })),
				h("div", { className: "nr-set-row" },
					h("span", { className: "nr-set-label" }, "字体大小（" + s.fontSize + "px）"),
					h("input", { className: "nr-range", type: "range", min: 12, max: 28, step: 1, value: s.fontSize, onChange: function (e) { props.onSetting("fontSize", Number(e.target.value)); } })),
				h("div", { className: "nr-set-row" },
					h("span", { className: "nr-set-label" }, "行高（" + s.lineHeight + "）"),
					h("input", { className: "nr-range", type: "range", min: 1.2, max: 2.6, step: 0.1, value: s.lineHeight, onChange: function (e) { props.onSetting("lineHeight", Number(e.target.value)); } })),
				h("div", { className: "nr-muted", style: { marginTop: "10px" } }, "说明：快捷键收起/展开在页面任意位置生效；翻页键仅在阅读器展开且不在输入框时生效。"));
		}

		// ── root panel ─────────────────────────────────────────────────────
		function ReaderPanel(props) {
			var tabState = React.useState("library");
			var tab = tabState[0], setTab = tabState[1];
			var novelsState = React.useState([]);
			var novels = novelsState[0], setNovels = novelsState[1];
			var readingState = React.useState(null); // { id, title, ... } current novel
			var reading = readingState[0], setReading = readingState[1];
			var errState = React.useState("");
			var error = errState[0], setError = errState[1];

			var progressRef = React.useRef(loadProgress());

			React.useEffect(function () {
				idbAll().then(function (rows) {
					rows.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
					setNovels(rows);
				}).catch(function () {});
			}, []);

			function refresh(novel, removed) {
				setNovels(function (prev) {
					var next = prev.filter(function (x) { return x.id !== novel.id; });
					if (!removed) next.unshift(novel);
					return next;
				});
			}

			function addText(title, text, source) {
				if (!text || text.trim().length < 10) { setError("内容为空或过短"); return; }
				var novel = { id: uid(), title: title || "未命名", author: "", source: source, text: text, addedAt: Date.now() };
				idbPut(novel).then(function () { refresh(novel, false); setTab("library"); setError(""); })
					.catch(function () { setError("写入书库失败"); });
			}

			function importBook(book) {
				// 搜索结果只含元信息：先存一个"待读"占位，内容靠后续导入/抓取填充
				var novel = {
					id: uid(), title: book.title, author: book.author || "",
					source: "在线搜索 · 待导入内容", text: "《" + book.title + "》\n\n" + (book.summary || "") + "\n\n（此为搜索结果的简介占位。请通过「导入 TXT」填入全文，或配置书源后抓取章节。）",
					addedAt: Date.now()
				};
				idbPut(novel).then(function () { refresh(novel, false); setTab("library"); });
			}

			function deleteNovel(n) {
				idbDelete(n.id).then(function () {
					refresh(n, true);
					if (reading !== null && reading.id === n.id) setReading(null);
					var p = progressRef.current; delete p[n.id]; saveProgress(p);
				});
			}

			function openRead(n) {
				setReading(n);
			}

			var currentPage = reading !== null ? pageNum((progressRef.current[reading.id] || {}).page, 0) : 0;
			function setPage(p) {
				if (reading === null) return;
				var pages = paginate(reading.text, props.settings.pageSize);
				var clamped = Math.max(0, Math.min(p, pages.length - 1));
				progressRef.current[reading.id] = { page: clamped, updatedAt: Date.now() };
				saveProgress(progressRef.current);
				// 强制重渲染（progress 在 ref 里）
				setReading(function (r) { return r === null ? null : Object.assign({}, r); });
			}

			// 翻页快捷键（仅面板展开、非输入时生效）
			React.useEffect(function () {
				function onKey(e) {
					if (isTypingTarget(e)) return;
					var combo = comboFromEvent(e);
					if (combo === null) return;
					var hk = props.settings.hotkeys;
					if (reading !== null) {
						if (combo === hk.prevPage) { e.preventDefault(); setPage(currentPage - 1); }
						else if (combo === hk.nextPage) { e.preventDefault(); setPage(currentPage + 1); }
					}
				}
				window.addEventListener("keydown", onKey);
				return function () { window.removeEventListener("keydown", onKey); };
			});

			var body;
			if (reading !== null) {
				body = h(ReaderView, {
					novel: reading,
					settings: props.settings,
					page: currentPage,
					onPage: setPage,
					onBack: function () { setReading(null); }
				});
			} else if (tab === "search") {
				body = h(SearchView, { onImportBook: importBook, onAddText: addText });
			} else if (tab === "settings") {
				body = h(SettingsView, {
					settings: props.settings,
					onHotkey: props.onHotkey,
					onSetting: props.onSetting
				});
			} else {
				body = h(LibraryView, {
					novels: novels,
					onAddText: addText,
					onRead: openRead,
					onDelete: deleteNovel,
					onError: setError
				});
			}

			return h("div", { className: "nr-panel" },
				h("div", { className: "nr-head" },
					h("span", { className: "nr-title" }, "小说阅读器"),
					h("span", { className: "nr-muted" }, comboDisplay(props.settings.hotkeys.toggle) + " 收起"),
					h("button", { className: "nr-icon-btn", title: "收起", onClick: props.onClose }, "×")),
				reading === null ? h("div", { className: "nr-tabs" },
					h("button", { className: "nr-tab" + (tab === "library" ? " active" : ""), onClick: function () { setTab("library"); } }, "书库"),
					h("button", { className: "nr-tab" + (tab === "search" ? " active" : ""), onClick: function () { setTab("search"); } }, "搜索"),
					h("button", { className: "nr-tab" + (tab === "settings" ? " active" : ""), onClick: function () { setTab("settings"); } }, "设置")) : null,
				error ? h("div", { className: "nr-error", style: { padding: "6px 12px 0" } }, error) : null,
				h("div", { className: "nr-body" }, body));
		}

		function ReaderAction() {
			var openState = React.useState(false);
			var open = openState[0], setOpen = openState[1];
			var settingsState = React.useState(loadSettings);
			var settings = settingsState[0], setSettings = settingsState[1];

			function update(mutator) {
				setSettings(function (prev) {
					var next = cloneSettings(prev);
					mutator(next);
					saveSettings(next);
					return next;
				});
			}
			var onHotkey = function (action, combo) { update(function (s) { s.hotkeys[action] = combo; }); };
			var onSetting = function (k, v) { update(function (s) { s[k] = v; }); };

			// 全局收起/展开快捷键
			React.useEffect(function () {
				function onKey(e) {
					if (isTypingTarget(e)) return;
					var combo = comboFromEvent(e);
					if (combo !== null && combo === settings.hotkeys.toggle) {
						e.preventDefault();
						setOpen(function (o) { return !o; });
					}
				}
				window.addEventListener("keydown", onKey);
				return function () { window.removeEventListener("keydown", onKey); };
			}, [settings.hotkeys.toggle]);

			return h(React.Fragment, null,
				h("button", {
					className: "nr-trigger",
					title: "小说阅读器（" + comboDisplay(settings.hotkeys.toggle) + "）",
					onClick: function () { setOpen(!open); }
				}, "阅读"),
				open ? ReactDOM.createPortal(h(ReaderPanel, {
					settings: settings,
					onHotkey: onHotkey,
					onSetting: onSetting,
					onClose: function () { setOpen(false); }
				}), document.body) : null);
		}

		// ── apply ──────────────────────────────────────────────────────────
		function apply(ctx) {
			ctx.effect(function () {
				var style = document.createElement("style");
				style.textContent = CSS;
				document.head.appendChild(style);
				return function () { style.remove(); };
			}, "novel-reader: styles");
			ctx.slots.inject("conversation.session.header.actions", function () {
				return ctx.slots.register(
					{ name: "conversation.session.header.actions", id: "novel-reader", order: 40 },
					ReaderAction
				);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.name = "@kingkk/dsh-novel-reader";
		return module.exports;
	}
});
