/**
 * dsh-gomoku-local browser bundle: a Gomoku (five-in-a-row) board registered
 * as a session-header action. All play is local to the page — human vs human,
 * or against a built-in heuristic engine. No LLM calls, no tokens, no network.
 */
window.__ModuleLoader__.load({
	id: "dsh-gomoku-local",
	factory: function (require) {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");
		var h = React.createElement;

		var SIZE = 15;
		var EMPTY = 0, BLACK = 1, WHITE = 2;
		var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
		var STAR = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];

		function createBoard() {
			var board = [];
			for (var r = 0; r < SIZE; r++) {
				var row = [];
				for (var c = 0; c < SIZE; c++) row.push(EMPTY);
				board.push(row);
			}
			return board;
		}

		function inBounds(r, c) {
			return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
		}

		function findWinLine(board, row, col, color) {
			for (var i = 0; i < DIRS.length; i++) {
				var dr = DIRS[i][0], dc = DIRS[i][1];
				var cells = [[row, col]];
				for (var s = 1; s < 5; s++) {
					var r1 = row + dr * s, c1 = col + dc * s;
					if (!inBounds(r1, c1) || board[r1][c1] !== color) break;
					cells.push([r1, c1]);
				}
				for (var t = 1; t < 5; t++) {
					var r2 = row - dr * t, c2 = col - dc * t;
					if (!inBounds(r2, c2) || board[r2][c2] !== color) break;
					cells.unshift([r2, c2]);
				}
				if (cells.length >= 5) return cells;
			}
			return null;
		}

		function lineShape(board, row, col, color, dr, dc) {
			var count = 1, openEnds = 0;
			var r = row + dr, c = col + dc;
			while (inBounds(r, c) && board[r][c] === color) { count++; r += dr; c += dc; }
			if (inBounds(r, c) && board[r][c] === EMPTY) openEnds++;
			r = row - dr; c = col - dc;
			while (inBounds(r, c) && board[r][c] === color) { count++; r -= dr; c -= dc; }
			if (inBounds(r, c) && board[r][c] === EMPTY) openEnds++;
			return { count: count, openEnds: openEnds };
		}

		function scoreCell(board, row, col, color) {
			var total = 0;
			for (var i = 0; i < DIRS.length; i++) {
				var shape = lineShape(board, row, col, color, DIRS[i][0], DIRS[i][1]);
				var n = shape.count, open = shape.openEnds;
				if (n >= 5) total += 1000000;
				else if (n === 4 && open === 2) total += 100000;
				else if (n === 4 && open === 1) total += 15000;
				else if (n === 3 && open === 2) total += 8000;
				else if (n === 3 && open === 1) total += 800;
				else if (n === 2 && open === 2) total += 600;
				else if (n === 2 && open === 1) total += 80;
				else if (n === 1 && open === 2) total += 20;
				else total += 2;
			}
			return total;
		}

		function hasNeighbor(board, row, col) {
			for (var dr = -2; dr <= 2; dr++) {
				for (var dc = -2; dc <= 2; dc++) {
					if (dr === 0 && dc === 0) continue;
					var r = row + dr, c = col + dc;
					if (inBounds(r, c) && board[r][c] !== EMPTY) return true;
				}
			}
			return false;
		}

		function pickAiMove(board, aiColor) {
			var humanColor = aiColor === BLACK ? WHITE : BLACK;
			var hasStone = false;
			for (var r0 = 0; r0 < SIZE && !hasStone; r0++) {
				for (var c0 = 0; c0 < SIZE; c0++) {
					if (board[r0][c0] !== EMPTY) { hasStone = true; break; }
				}
			}
			if (!hasStone) return [7, 7];
			var best = null, bestScore = -1;
			for (var r = 0; r < SIZE; r++) {
				for (var c = 0; c < SIZE; c++) {
					if (board[r][c] !== EMPTY) continue;
					if (!hasNeighbor(board, r, c)) continue;
					var attack = scoreCell(board, r, c, aiColor);
					var defense = scoreCell(board, r, c, humanColor);
					var score = attack + defense * 0.92;
					if (score > bestScore) { bestScore = score; best = [r, c]; }
				}
			}
			return best;
		}

		function cloneBoard(board) {
			return board.map(function (row) { return row.slice(); });
		}

		var CSS = [
			".gl-trigger { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; line-height: 18px; }",
			".gl-trigger:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }",
			".gl-panel { position: fixed; top: 64px; right: 16px; z-index: 220; width: 440px; max-width: calc(100vw - 32px); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 12px 32px rgba(0,0,0,0.22); padding: 12px; display: flex; flex-direction: column; gap: 10px; }",
			".gl-panel-head { display: flex; align-items: center; gap: 8px; }",
			".gl-panel-title { font-weight: 600; color: var(--dsw-alias-label-primary); font-size: 14px; margin-right: auto; }",
			".gl-close { border: 0; background: none; color: var(--dsw-alias-label-secondary); font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px; }",
			".gl-close:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }",
			".gl-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }",
			".gl-btn { padding: 3px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 12px; line-height: 18px; }",
			".gl-btn:hover { border-color: var(--dsw-alias-brand-primary); }",
			".gl-btn.active { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-brand-primary); }",
			".gl-btn:disabled { opacity: 0.45; cursor: default; }",
			".gl-status { font-size: 12px; color: var(--dsw-alias-label-secondary); display: flex; align-items: center; gap: 6px; }",
			".gl-status-stone { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }",
			".gl-status-stone.black { background: #222; border: 1px solid #555; }",
			".gl-status-stone.white { background: #f5f5f5; border: 1px solid #999; }",
			".gl-status.win { color: var(--dsw-alias-state-success-primary); font-weight: 600; }",
			".gl-board { display: grid; grid-template-columns: repeat(15, 1fr); aspect-ratio: 1; background: #e3b96b; border-radius: 8px; width: 100%; box-shadow: inset 0 0 0 1px rgba(120, 80, 20, 0.5); }",
			".gl-cell { position: relative; cursor: pointer; }",
			".gl-cell::before { content: \"\"; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: rgba(90, 60, 15, 0.75); transform: translateY(-0.5px); }",
			".gl-cell::after { content: \"\"; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: rgba(90, 60, 15, 0.75); transform: translateX(-0.5px); }",
			".gl-cell.edge-top::after { top: 50%; }",
			".gl-cell.edge-bottom::after { bottom: 50%; }",
			".gl-cell.edge-left::before { left: 50%; }",
			".gl-cell.edge-right::before { right: 50%; }",
			".gl-star { position: absolute; width: 14%; height: 14%; border-radius: 50%; background: rgba(90, 60, 15, 0.9); left: 50%; top: 50%; transform: translate(-50%, -50%); pointer-events: none; }",
			".gl-stone { position: absolute; width: 82%; height: 82%; border-radius: 50%; left: 50%; top: 50%; transform: translate(-50%, -50%); pointer-events: none; }",
			".gl-stone.black { background: radial-gradient(circle at 35% 30%, #666, #111 70%); box-shadow: 0 1px 2px rgba(0,0,0,0.5); }",
			".gl-stone.white { background: radial-gradient(circle at 35% 30%, #fff, #cfcfcf 75%); box-shadow: 0 1px 2px rgba(0,0,0,0.4); }",
			".gl-stone.last { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }",
			".gl-stone.win { outline: 2px solid var(--dsw-alias-state-success-primary); outline-offset: -2px; }",
			".gl-cell.playable:hover .gl-hover { position: absolute; width: 82%; height: 82%; border-radius: 50%; left: 50%; top: 50%; transform: translate(-50%, -50%); background: rgba(0, 0, 0, 0.18); pointer-events: none; }"
		].join("\n");

		function GomokuGame() {
			var modeState = React.useState("pvp");
			var mode = modeState[0], setMode = modeState[1];
			var boardState = React.useState(createBoard);
			var board = boardState[0], setBoard = boardState[1];
			var currentState = React.useState(BLACK);
			var current = currentState[0], setCurrent = currentState[1];
			var winnerState = React.useState(null);
			var winner = winnerState[0], setWinner = winnerState[1];
			var winLineState = React.useState(null);
			var winLine = winLineState[0], setWinLine = winLineState[1];
			var historyState = React.useState([]);
			var history = historyState[0], setHistory = historyState[1];

			var aiColor = WHITE;
			var humanColor = BLACK;

			function place(row, col) {
				if (winner !== null) return;
				if (board[row][col] !== EMPTY) return;
				if (mode === "ai" && current !== humanColor) return;

				var nextBoard = cloneBoard(board);
				nextBoard[row][col] = current;
				var line = findWinLine(nextBoard, row, col, current);
				var nextHistory = history.concat([{ row: row, col: col, color: current }]);

				if (line !== null) {
					setBoard(nextBoard); setHistory(nextHistory);
					setWinner(current); setWinLine(line);
					return;
				}

				if (mode === "ai") {
					var ai = pickAiMove(nextBoard, aiColor);
					if (ai !== null) {
						nextBoard[ai[0]][ai[1]] = aiColor;
						nextHistory = nextHistory.concat([{ row: ai[0], col: ai[1], color: aiColor }]);
						var aiLine = findWinLine(nextBoard, ai[0], ai[1], aiColor);
						setBoard(nextBoard); setHistory(nextHistory);
						if (aiLine !== null) { setWinner(aiColor); setWinLine(aiLine); }
						return;
					}
				}

				setBoard(nextBoard); setHistory(nextHistory);
				setCurrent(current === BLACK ? WHITE : BLACK);
			}

			function restart(nextMode) {
				setBoard(createBoard()); setCurrent(BLACK);
				setWinner(null); setWinLine(null); setHistory([]);
				if (nextMode !== undefined) setMode(nextMode);
			}

			function undo() {
				if (history.length === 0) return;
				var nextBoard = cloneBoard(board);
				var nextHistory = history;
				if (mode === "ai") {
					var steps = Math.min(2, history.length);
					for (var i = 0; i < steps; i++) {
						var m = nextHistory[nextHistory.length - 1];
						nextBoard[m.row][m.col] = EMPTY;
						nextHistory = nextHistory.slice(0, nextHistory.length - 1);
					}
					setCurrent(humanColor);
				} else {
					var last = nextHistory[nextHistory.length - 1];
					nextBoard[last.row][last.col] = EMPTY;
					nextHistory = nextHistory.slice(0, nextHistory.length - 1);
					setCurrent(last.color);
				}
				setBoard(nextBoard); setHistory(nextHistory);
				setWinner(null); setWinLine(null);
			}

			var lastMove = history.length > 0 ? history[history.length - 1] : null;
			var winSet = {};
			if (winLine !== null) {
				for (var wi = 0; wi < winLine.length; wi++) winSet[winLine[wi][0] + "," + winLine[wi][1]] = true;
			}

			var statusNode;
			if (winner !== null) {
				var wLabel = winner === BLACK ? "黑棋" : "白棋";
				var wCls = winner === BLACK ? "black" : "white";
				statusNode = h("div", { className: "gl-status win" },
					h("span", { className: "gl-status-stone " + wCls }),
					wLabel + " 获胜！");
			} else {
				var cLabel = current === BLACK ? "黑棋" : "白棋";
				var cCls = current === BLACK ? "black" : "white";
				var suffix = mode === "ai" ? (current === humanColor ? "（你）" : "（电脑）") : "";
				statusNode = h("div", { className: "gl-status" },
					h("span", { className: "gl-status-stone " + cCls }),
					"轮到 " + cLabel + suffix);
			}

			var cells = [];
			for (var r = 0; r < SIZE; r++) {
				for (var c = 0; c < SIZE; c++) {
					(function (row, col) {
						var v = board[row][col];
						var classes = ["gl-cell"];
						if (row === 0) classes.push("edge-top");
						if (row === SIZE - 1) classes.push("edge-bottom");
						if (col === 0) classes.push("edge-left");
						if (col === SIZE - 1) classes.push("edge-right");
						var playable = winner === null && v === EMPTY && !(mode === "ai" && current !== humanColor);
						if (playable) classes.push("playable");

						var children = [];
						var isStar = false;
						for (var si = 0; si < STAR.length; si++) {
							if (STAR[si][0] === row && STAR[si][1] === col) { isStar = true; break; }
						}
						if (isStar && v === EMPTY) children.push(h("span", { key: "star", className: "gl-star" }));
						if (v !== EMPTY) {
							var stoneClasses = ["gl-stone", v === BLACK ? "black" : "white"];
							if (lastMove !== null && lastMove.row === row && lastMove.col === col && winner === null) stoneClasses.push("last");
							if (winSet[row + "," + col] === true) stoneClasses.push("win");
							children.push(h("span", { key: "stone", className: stoneClasses.join(" ") }));
						} else if (playable) {
							children.push(h("span", { key: "hover", className: "gl-hover" }));
						}

						cells.push(h("div", {
							key: row + "-" + col,
							className: classes.join(" "),
							onClick: function () { place(row, col); }
						}, children));
					})(r, c);
				}
			}

			return h("div", null,
				h("div", { className: "gl-toolbar" },
					h("button", {
						className: "gl-btn" + (mode === "pvp" ? " active" : ""),
						onClick: function () { restart("pvp"); }
					}, "双人对弈"),
					h("button", {
						className: "gl-btn" + (mode === "ai" ? " active" : ""),
						onClick: function () { restart("ai"); }
					}, "人机对战"),
					h("button", {
						className: "gl-btn",
						disabled: history.length === 0,
						onClick: undo
					}, "悔棋"),
					h("button", {
						className: "gl-btn",
						onClick: function () { restart(); }
					}, "重新开始")),
				statusNode,
				h("div", { className: "gl-board" }, cells));
		}

		function GomokuAction() {
			var openState = React.useState(false);
			var open = openState[0], setOpen = openState[1];
			return h(React.Fragment, null,
				h("button", {
					className: "gl-trigger",
					title: "五子棋",
					onClick: function () { setOpen(!open); }
				}, "五子棋"),
				open ? h("div", { className: "gl-panel" },
					h("div", { className: "gl-panel-head" },
						h("span", { className: "gl-panel-title" }, "五子棋 · 本地对弈"),
						h("button", {
							className: "gl-close",
							title: "关闭",
							onClick: function () { setOpen(false); }
						}, "×")),
					h(GomokuGame)) : null);
		}

		function apply(ctx) {
			ctx.effect(function () {
				var style = document.createElement("style");
				style.textContent = CSS;
				document.head.appendChild(style);
				return function () { style.remove(); };
			}, "gomoku-local: styles");
			ctx.slots.inject("conversation.session.header.actions", function () {
				return ctx.slots.register(
					{ name: "conversation.session.header.actions", id: "gomoku-local", order: 30 },
					GomokuAction
				);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
