/** Local scratch calculator. It never writes report fields or task data. */
(function (global) {
  "use strict";
  const namespace = "sln.report-calculator.v1:";
  function evaluate(expression, options = {}) {
    const source = String(expression).replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/π/g, "pi").replace(/\s+/g, "");
    if (!source || source.length > 200) throw new Error("Enter a calculation.");
    const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+\d*|[(),+*/%^!\-]/gi) || [];
    if (tokens.join("") !== source || tokens.length > 100) throw new Error("Check the calculation.");
    let cursor = 0;
    const radians = options.angleMode === "rad";
    const toAngle = (value) => radians ? value : value * Math.PI / 180;
    const fromAngle = (value) => radians ? value : value * 180 / Math.PI;
    const tidyTrig = (value) => Math.abs(value) < 1e-14 ? 0 : value;
    const functions = {
      sqrt: Math.sqrt, cbrt: Math.cbrt, ln: Math.log, log10: Math.log10, log2: Math.log2,
      exp: Math.exp, pow10: (x) => 10 ** x, pow2: (x) => 2 ** x,
      sin: (x) => tidyTrig(Math.sin(toAngle(x))), cos: (x) => tidyTrig(Math.cos(toAngle(x))),
      tan: (x) => { const angle = toAngle(x); if (Math.abs(Math.cos(angle)) < 1e-14) throw new Error("Tangent is undefined at this angle."); return tidyTrig(Math.tan(angle)); },
      asin: (x) => fromAngle(Math.asin(x)), acos: (x) => fromAngle(Math.acos(x)), atan: (x) => fromAngle(Math.atan(x)),
      sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
      reciprocal: (x) => { if (!x) throw new Error("Cannot divide by zero."); return 1 / x; },
      root: (x, n) => { if (!n) throw new Error("Root degree cannot be zero."); return x < 0 && Number.isInteger(n) && Math.abs(n % 2) === 1 ? -((-x) ** (1 / n)) : x ** (1 / n); },
      log: (x, base) => base > 0 && base !== 1 ? Math.log(x) / Math.log(base) : NaN,
    };
    function factorial(value) {
      if (!Number.isInteger(value) || value < 0 || value > 170) throw new Error("Factorial requires an integer from 0 to 170.");
      let result = 1;
      for (let number = 2; number <= value; number++) result *= number;
      return result;
    }
    function primary() {
      const token = tokens[cursor++];
      let answer;
      if (token === "+" || token === "-") {
        answer = power();
        if (token === "-") answer.value *= -1;
      } else if (token === "(") {
        answer = addition();
        if (tokens[cursor++] !== ")") throw new Error("Close the bracket.");
      } else if (token === "pi" || token === "e") {
        answer = {value: token === "pi" ? Math.PI : Math.E, percent: false};
      } else if (Object.hasOwn(functions, token || "")) {
        if (tokens[cursor++] !== "(") throw new Error("Put function arguments inside brackets.");
        const args = [addition().value];
        while (tokens[cursor] === ",") { cursor++; args.push(addition().value); }
        if (tokens[cursor++] !== ")") throw new Error("Close the bracket.");
        if (args.length !== (["root", "log"].includes(token) ? 2 : 1)) throw new Error(`${token} needs ${["root", "log"].includes(token) ? "two arguments" : "one argument"}.`);
        answer = {value: functions[token](...args), percent: false};
      } else {
        if (!token || !Number.isFinite(Number(token))) throw new Error("Check the calculation.");
        answer = {value: Number(token), percent: false};
      }
      while (["%", "!"].includes(tokens[cursor])) {
        const operator = tokens[cursor++];
        answer = operator === "%" ? {value: answer.value / 100, percent: true} : {value: factorial(answer.value), percent: false};
      }
      return answer;
    }
    function power() {
      const left = primary();
      if (tokens[cursor] !== "^") return left;
      cursor++;
      return {value: left.value ** power().value, percent: false};
    }
    function product() {
      let answer = power();
      while (["*", "/"].includes(tokens[cursor])) {
        const operator = tokens[cursor++], right = power();
        if (operator === "/" && right.value === 0) throw new Error("Cannot divide by zero.");
        answer = {value: operator === "*" ? answer.value * right.value : answer.value / right.value, percent: false};
      }
      return answer;
    }
    function addition() {
      let answer = product();
      while (["+", "-"].includes(tokens[cursor])) {
        const operator = tokens[cursor++], right = product();
        const value = right.percent ? answer.value * right.value : right.value;
        answer = {value: operator === "+" ? answer.value + value : answer.value - value, percent: false};
      }
      return answer;
    }
    const result = addition().value;
    if (cursor !== tokens.length) throw new Error("Check the calculation.");
    if (!Number.isFinite(result)) throw new Error("This calculation has no finite real result.");
    return Number(result.toPrecision(15));
  }

  function install(aside) {
    if (document.getElementById("report-calculator")) return;
    const tools = document.createElement("div"); tools.className = "report-tools";
    tools.innerHTML = `<button type="button" class="report-calculator-launch" aria-controls="report-calculator" aria-expanded="false" title="Calculator"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m3 0h1m3 0h0M8 15h1m3 0h1m3 0h0M8 19h1m3 0h1m3 0h0"/></svg><span>Calculator</span></button>`;
    aside.append(tools);
    const launch = tools.querySelector("button"), panel = document.createElement("section");
    panel.id = "report-calculator"; panel.className = "report-calculator"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "false"); panel.setAttribute("aria-labelledby", "calculator-title"); panel.tabIndex = -1;
    panel.innerHTML = `<div class="calculator-drag"><strong id="calculator-title">Calculator</strong><button type="button" data-calc="history" title="Calculation history" aria-expanded="false">History</button><button type="button" data-calc="close" aria-label="Close calculator">×</button></div>
      <div class="calculator-mode" role="group" aria-label="Calculator mode"><button type="button" data-calc="mode-basic" aria-pressed="true">Basic</button><button type="button" data-calc="mode-scientific" aria-pressed="false">Scientific</button></div>
      <div class="calculator-science-status" hidden><span id="calculator-memory" aria-live="polite"></span><button type="button" data-calc="angle" title="Switch between degrees and radians">DEG</button></div>
      <div class="calculator-display"><div id="calculator-expression" aria-label="Expression"></div><output id="calculator-result" aria-live="polite">0</output></div>
      <div class="calculator-key-layout"><div class="calculator-scientific-keys" hidden></div><div class="calculator-keys">${["AC", "⌫", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "±", "0", ".", "="].map((key) => `<button type="button" data-calc="${key}" class="${["÷", "×", "−", "+", "="].includes(key) ? "calculator-operator" : ""}" aria-label="${{"⌫":"Backspace", "AC":"Clear", "±":"Change sign"}[key] || key}">${key}</button>`).join("")}</div></div>
      <div class="calculator-actions"><button type="button" data-calc="copy">Copy result</button><span id="calculator-feedback" role="status"></span></div><section class="calculator-history" hidden><div><strong>Today’s history</strong><button type="button" data-calc="clear-history">Clear history</button></div><ol id="calculator-history-list"></ol></section>`;
    document.body.append(panel);
    const expressionBox = panel.querySelector("#calculator-expression"), output = panel.querySelector("output"), feedback = panel.querySelector("#calculator-feedback"), historyBox = panel.querySelector(".calculator-history");
    const user = encodeURIComponent(global.__VALUX_AUTH_CONTEXT__?.user?.userId || "practice");
    const task = new URLSearchParams(location.search).get("task") || `practice:${location.pathname}`;
    const prefix = `${namespace}${user}:`, storageKey = () => `${prefix}${encodeURIComponent(task)}:${global.ValuxTime.today()}`;
    const freshState = () => ({expression: "", result: 0, history: [], mode: "basic", angleMode: "deg", secondary: false, memory: 0, memorySet: false});
    let activeKey = "", state = freshState(), justCalculated = false;
    const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[character]);
    function load() {
      const key = storageKey(); if (key === activeKey) return;
      activeKey = key; state = freshState(); justCalculated = false;
      try {
        const saved = JSON.parse(localStorage.getItem(key) || "null");
        if (saved && typeof saved.expression === "string" && Number.isFinite(saved.result) && Array.isArray(saved.history)) state = {...state, ...saved, history: saved.history.slice(-100)};
        state.mode = state.mode === "scientific" ? "scientific" : "basic";
        state.angleMode = state.angleMode === "rad" ? "rad" : "deg";
        if (!Number.isFinite(state.memory)) { state.memory = 0; state.memorySet = false; }
        for (const old of Object.keys(localStorage)) if (old.startsWith(prefix) && !old.endsWith(`:${global.ValuxTime.today()}`)) localStorage.removeItem(old);
      } catch (_) { /* A blocked browser store still permits scratch calculations. */ }
    }
    function save() { try { localStorage.setItem(activeKey, JSON.stringify(state)); } catch (_) { feedback.textContent = "History could not be saved in this browser."; } }
    function render() {
      const scientific = state.mode === "scientific";
      panel.classList.toggle("is-scientific", scientific);
      panel.querySelector(".calculator-scientific-keys").hidden = !scientific;
      panel.querySelector(".calculator-science-status").hidden = !scientific;
      panel.querySelector('[data-calc="mode-basic"]').setAttribute("aria-pressed", String(!scientific));
      panel.querySelector('[data-calc="mode-scientific"]').setAttribute("aria-pressed", String(scientific));
      panel.querySelector('[data-calc="angle"]').textContent = state.angleMode.toUpperCase();
      panel.querySelector("#calculator-memory").textContent = state.memorySet ? `M: ${format(state.memory)}` : "Memory empty";
      const trig = state.secondary ? [["asin", "sin⁻¹"], ["acos", "cos⁻¹"], ["atan", "tan⁻¹"]] : [["sin", "sin"], ["cos", "cos"], ["tan", "tan"]];
      const hyperbolic = state.secondary ? [["asinh", "sinh⁻¹"], ["acosh", "cosh⁻¹"], ["atanh", "tanh⁻¹"]] : [["sinh", "sinh"], ["cosh", "cosh"], ["tanh", "tanh"]];
      const scientificKeys = [["(", "("], [")", ")"], ["mc", "mc"], ["m+", "m+"], ["m-", "m−"], ["mr", "mr"], ["secondary", "2nd"], ["square", "x²"], ["cube", "x³"], state.secondary ? ["log", "logᵧx"] : ["^", "xʸ"], state.secondary ? ["pow2", "2ˣ"] : ["exp", "eˣ"], state.secondary ? ["log2", "log₂"] : ["pow10", "10ˣ"], ["reciprocal", "1/x"], ["sqrt", "²√x"], ["cbrt", "³√x"], ["root", "ʸ√x"], ["ln", "ln"], ["log10", "log₁₀"], ["factorial", "x!"], ...trig, ["constant-e", "e"], ["EE", "EE"], ["random", "Rand"], ...hyperbolic, ["constant-pi", "π"], [",", ","]];
      const titles = {mc: "Clear memory", "m+": "Add to memory", "m-": "Subtract from memory", mr: "Recall memory", secondary: "Secondary scientific functions", root: "Root: root(value, degree)", log: "Logarithm: log(value, base)", EE: "Scientific notation exponent", random: "Random number between 0 and 1", ",": "Separate function arguments", square: "Square", cube: "Cube", factorial: "Factorial", "^": "Raise to a power"};
      panel.querySelector(".calculator-scientific-keys").innerHTML = scientificKeys.map(([key, label]) => `<button type="button" data-calc="${key}" title="${titles[key] || label}" aria-label="${titles[key] || label}"${key === "secondary" ? ` aria-pressed="${Boolean(state.secondary)}"` : ""}>${label}</button>`).join("");
      expressionBox.textContent = state.expression || "0";
      output.textContent = format(state.result);
      panel.querySelector("#calculator-history-list").innerHTML = state.history.length ? state.history.slice().reverse().map((item, index) => `<li><button type="button" data-result-index="${state.history.length - index - 1}" title="Reuse result"><span>${escape(item.expression)}${item.angleMode ? ` · ${escape(item.angleMode.toUpperCase())}` : ""}</span><strong>${escape(item.result)}</strong></button></li>`).join("") : "<li>No calculations today.</li>";
    }
    function format(value) {
      return value !== 0 && (Math.abs(value) >= 1e15 || Math.abs(value) < 1e-9) ? Number(value).toExponential(10) : Number(value).toLocaleString("en-IN", {maximumFractionDigits: 12});
    }
    function transformOperand(transform, empty) {
      const text = justCalculated ? String(state.result) : state.expression;
      if (!text || /[+−×÷*/^(,]$/.test(text)) { state.expression = text + empty; justCalculated = false; return; }
      let start = text.length;
      if (text.endsWith(")")) {
        let depth = 0;
        for (let index = text.length - 1; index >= 0; index--) {
          if (text[index] === ")") depth++;
          if (text[index] === "(" && --depth === 0) { start = index; break; }
        }
        while (start > 0 && /[a-z0-9]/i.test(text[start - 1]) && /[a-z]/i.test(text.slice(0, start).match(/[a-z0-9]+$/i)?.[0] || "")) start--;
      } else {
        const tail = text.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+−-]?\d+)?$|pi$|e$/i);
        start = tail ? text.length - tail[0].length : 0;
      }
      if (start > 0 && /[-−]/.test(text[start - 1]) && (start === 1 || /[+−×÷*/^(,]/.test(text[start - 2]))) start--;
      state.expression = text.slice(0, start) + transform(text.slice(start));
      justCalculated = false;
    }
    function insertLiteral(value) {
      if (justCalculated) state.expression = "";
      const multiply = /[\d)eπ]$/.test(state.expression);
      state.expression += (multiply ? "×" : "") + value;
      justCalculated = false;
    }
    function clamp(left, top) {
      panel.style.left = `${Math.max(8, Math.min(left, innerWidth - panel.offsetWidth - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(top, innerHeight - Math.min(panel.offsetHeight, innerHeight - 16) - 8))}px`;
    }
    function close() { panel.hidden = true; launch.setAttribute("aria-expanded", "false"); launch.focus(); }
    async function action(key) {
      load(); feedback.textContent = "";
      if (key === "close") { close(); return; }
      if (key === "history") { historyBox.hidden = !historyBox.hidden; panel.querySelector('[data-calc="history"]').setAttribute("aria-expanded", String(!historyBox.hidden)); const rect = panel.getBoundingClientRect(); clamp(rect.left, rect.top); return; }
      if (key === "clear-history") { state.history = []; }
      else if (key.startsWith("mode-")) { state.mode = key.slice(5); }
      else if (key === "angle") { state.angleMode = state.angleMode === "deg" ? "rad" : "deg"; }
      else if (key === "secondary") { state.secondary = !state.secondary; }
      else if (["mc", "m+", "m-", "mr"].includes(key)) {
        if (key === "mc") { state.memory = 0; state.memorySet = false; }
        else if (key === "mr") insertLiteral(`(${state.memory})`);
        else {
          try {
            const value = state.expression ? evaluate(state.expression, {angleMode: state.angleMode}) : state.result;
            const next = state.memory + (key === "m+" ? value : -value);
            if (!Number.isFinite(next)) throw new Error("Memory result is too large.");
            state.memory = next; state.memorySet = true;
          } catch (error) { feedback.textContent = error.message; return; }
        }
      }
      else if (key === "constant-pi" || key === "constant-e" || key === "random") insertLiteral(key === "constant-pi" ? "pi" : key === "constant-e" ? "e" : String(Math.random()));
      else if (key === "EE") {
        if (justCalculated) state.expression = String(state.result);
        if (!state.expression) state.expression = "1";
        if (!/(?:\d+\.?\d*|\.\d+)$/.test(state.expression)) { feedback.textContent = "Enter a number before EE."; return; }
        state.expression += "e"; justCalculated = false;
      }
      else if (["square", "cube", "factorial"].includes(key)) transformOperand((value) => `(${value})${key === "factorial" ? "!" : key === "square" ? "^2" : "^3"}`, key === "factorial" ? "0!" : key === "square" ? "0^2" : "0^3");
      else if (["sqrt", "cbrt", "reciprocal", "ln", "log10", "log2", "exp", "pow10", "pow2", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "root", "log"].includes(key)) {
        const binary = ["root", "log"].includes(key);
        transformOperand((value) => `${key}(${value}${binary ? "," : ")"}`, `${key}(`);
        if (binary) feedback.textContent = key === "root" ? "Enter the root degree, then close the bracket." : "Enter the logarithm base, then close the bracket.";
      }
      else if (key === "AC") { state.expression = ""; state.result = 0; justCalculated = false; }
      else if (key === "⌫") { state.expression = state.expression.slice(0, -1); justCalculated = false; }
      else if (key === "copy") {
        try {
          const value = String(state.result);
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
          else { const field = document.createElement("textarea"); field.value = value; document.body.append(field); field.select(); if (!document.execCommand("copy")) throw new Error("Copy unavailable"); field.remove(); }
          feedback.textContent = "Copied";
        } catch (_) { feedback.textContent = "Select the result to copy it."; }
        return;
      } else if (key === "=") {
        try { state.result = evaluate(state.expression, {angleMode: state.angleMode}); state.history.push({expression: state.expression, result: state.result, ...(state.mode === "scientific" ? {angleMode: state.angleMode} : {})}); state.history = state.history.slice(-100); justCalculated = true; }
        catch (error) { feedback.textContent = error.message; return; }
      } else if (key === "±") { state.expression = /e[+-]?$/.test(state.expression) ? state.expression.endsWith("e-") ? state.expression.slice(0, -1) : state.expression.replace(/e\+?$/, "e-") : state.expression.startsWith("-(") && state.expression.endsWith(")") ? state.expression.slice(2, -1) : `-(${state.expression || "0"})`; justCalculated = false; }
      else {
        if (justCalculated) state.expression = /^[0-9.]$/.test(key) ? "" : String(state.result);
        if (state.expression.length < 200) state.expression += key;
        justCalculated = false;
      }
      save(); render();
      if (key.startsWith("mode-") || key === "secondary") { const rect = panel.getBoundingClientRect(); clamp(rect.left, rect.top); }
    }
    launch.addEventListener("click", () => {
      if (!panel.hidden) { close(); return; }
      load(); render(); panel.hidden = false; launch.setAttribute("aria-expanded", "true");
      if (!panel.style.left) clamp(innerWidth - panel.offsetWidth - 24, 90);
      else { const rect = panel.getBoundingClientRect(); clamp(rect.left, rect.top); }
      panel.focus();
    });
    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.dataset.resultIndex !== undefined) { const item = state.history[Number(button.dataset.resultIndex)]; if (item) { state.expression = String(item.result); state.result = item.result; justCalculated = false; save(); render(); } }
      else action(button.dataset.calc);
    });
    panel.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab") return;
      const key = {Enter:"=", Escape:"close", Backspace:"⌫", Delete:"AC", "*":"×", "/":"÷", "-":"−"}[event.key] || event.key;
      if (["=", "close", "⌫", "AC", "×", "÷", "−", "+", "%", "(", ")", "^", "!", ","].includes(key) || /^[0-9.]$/.test(key)) { event.preventDefault(); action(key); }
    });
    const handle = panel.querySelector(".calculator-drag"); let drag = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button") || event.button !== 0) return;
      const rect = panel.getBoundingClientRect(); drag = {x: event.clientX - rect.left, y: event.clientY - rect.top};
      handle.setPointerCapture(event.pointerId); event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => { if (drag) clamp(event.clientX - drag.x, event.clientY - drag.y); });
    handle.addEventListener("pointerup", () => { drag = null; });
    handle.addEventListener("pointercancel", () => { drag = null; });
    global.addEventListener("resize", () => { if (!panel.hidden) { const rect = panel.getBoundingClientRect(); clamp(rect.left, rect.top); } });
  }
  global.ReportCalculator = {install, evaluate};
})(window);
