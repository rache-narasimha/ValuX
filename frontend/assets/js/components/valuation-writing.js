/** Address autofill and compact narrative formatting for valuation forms. */
(function (global) {
  "use strict";

  const addressId = "property.postal_address";
  const formatSuffix = "_formatting";
  const formatStates = new WeakMap();
  const narrativeSelector = 'textarea[name$=".details"][name^="documents."], textarea[name="site.special_remarks"]';

  function labelRow(field) {
    const row = document.createElement("div");
    row.className = "valuation-field-label-row";
    const label = field.parentElement.querySelector("label");
    label.before(row);
    row.append(label);
    return row;
  }

  function installAddress(form, reportType, savedMode, { beforeEdit, onEdit, hasRetainedReport }) {
    const field = form.elements.namedItem(addressId);
    const sourceNames = [
      "property.door_number",
      reportType === "general" ? "property.plot_survey_number" : "property.survey_number",
      "property.village",
      reportType === "general" ? "property.ward_taluka" : "property.taluka",
      "property.mandal_district",
    ];
    let mode = savedMode || "";
    let lastAddress = field.value;

    function generatedAddress() {
      const parts = sourceNames.map((name) => form.elements.namedItem(name)?.value.trim() || "");
      if (parts[0] && !/^(?:d\.?\s*no\b|door\b)/i.test(parts[0])) parts[0] = "D.No. " + parts[0];
      const seen = new Set();
      return parts.flatMap((part) => part.split(",")).map((part) => part.trim())
        .filter((part) => {
          const key = part.replace(/[.\s]+$/g, "").toLowerCase();
          if (!key || /^[-–—]+$/.test(key) || seen.has(key)) return false;
          seen.add(key);
          return true;
        }).join(", ");
    }

    function applyAddress() {
      field.value = generatedAddress();
      lastAddress = field.value;
      mode = "auto";
      global.FormTabOrder?.mark(field);
    }

    function changed(id) {
      if (global.ReportData.readOnly) return;
      if (id === addressId && field.value !== lastAddress) {
        mode = "manual";
        lastAddress = field.value;
        global.FormTabOrder?.mark(field, false);
      } else if (sourceNames.includes(id) && (mode === "auto" || (!mode && !field.value.trim()))) {
        applyAddress();
      }
    }

    if (!global.ReportData.readOnly) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "valuation-address-action";
      action.textContent = "Use address from fields";
      labelRow(field).append(action);
      action.addEventListener("click", () => {
        const address = generatedAddress();
        const changesReport = field.value !== address;
        if (action.disabled || !address || (!changesReport && mode === "auto")) return;
        if (changesReport && !beforeEdit()) return;
        applyAddress();
        onEdit(changesReport);
      });
      if (!hasRetainedReport && (mode === "auto" || (!mode && !field.value.trim() && generatedAddress()))) {
        applyAddress();
      } else if (mode === "auto") {
        global.FormTabOrder?.mark(field);
      }
    }

    return { changed, get mode() { return mode; } };
  }

  function readBlocks(editor) {
    const blocks = [];
    let runs = [];
    function addText(text, bold) {
      if (!text) return;
      if (runs.at(-1)?.bold === bold) runs.at(-1).text += text;
      else runs.push({ text, bold });
    }
    function inline(node, bold = false) {
      if (node.nodeType === Node.TEXT_NODE) {
        addText(node.data.replaceAll("\u00a0", " "), bold);
      } else if (node.nodeName === "BR") {
        if (node.parentNode.childNodes.length > 1) addText("\n", bold);
      } else {
        const isBold = bold || node.matches?.("b, strong");
        node.childNodes.forEach((child) => inline(child, Boolean(isBold)));
      }
    }
    function finish(kind) {
      blocks.push({ kind, runs });
      runs = [];
    }
    for (const child of editor.childNodes) {
      if (child.matches?.("ol, ul")) {
        if (runs.length) finish("paragraph");
        for (const item of child.children) {
          inline(item);
          finish(child.nodeName === "OL" ? "number" : "bullet");
        }
      } else if (child.matches?.("div, p")) {
        if (runs.length) finish("paragraph");
        inline(child);
        finish("paragraph");
      } else {
        inline(child);
      }
    }
    if (runs.length) finish("paragraph");
    return blocks;
  }

  function plainText(blocks) {
    let number = 0;
    return blocks.map(({ kind, runs }) => {
      const text = runs.map((run) => run.text).join("");
      if (kind !== "number") number = 0;
      if (!text.trim()) return text;
      return (kind === "number" ? ++number + ". " : kind === "bullet" ? "• " : "") + text;
    }).join("\n");
  }

  function paint(editor, field) {
    editor.replaceChildren();
    let list;
    for (const { kind, runs } of formatStates.get(field) || []) {
      const listType = kind === "number" ? "OL" : kind === "bullet" ? "UL" : null;
      const line = document.createElement(listType ? "li" : "div");
      if (listType) {
        if (list?.tagName !== listType) {
          list = document.createElement(listType);
          editor.append(list);
        }
        list.append(line);
      } else {
        list = null;
        editor.append(line);
      }
      for (const { text, bold } of runs) {
        const target = bold ? line.appendChild(document.createElement("strong")) : line;
        text.split("\n").forEach((part, index) => {
          if (index) target.append(document.createElement("br"));
          target.append(document.createTextNode(part));
        });
      }
      if (!line.textContent) line.append(document.createElement("br"));
    }
    if (!editor.childNodes.length) editor.textContent = field.value;
    editor.dataset.placeholder = field.placeholder;
  }

  function restoreField(field, values) {
    let blocks;
    try { blocks = JSON.parse(values[field.name + formatSuffix] || "null"); }
    catch { blocks = null; }
    const valid = Array.isArray(blocks) && blocks.every((block) =>
      block && ["paragraph", "number", "bullet"].includes(block.kind) &&
      Array.isArray(block.runs) && block.runs.every((run) => run && typeof run.text === "string" && typeof run.bold === "boolean"));
    if (valid && plainText(blocks) === field.value) formatStates.set(field, blocks);
    else formatStates.delete(field);
    const editor = field.parentElement.querySelector(".valuation-narrative");
    if (editor) paint(editor, field);
  }

  function restoreFormatting(form, values) {
    form.querySelectorAll(narrativeSelector).forEach((field) => restoreField(field, values));
  }

  function collectFormatting(form, values) {
    form.querySelectorAll(narrativeSelector).forEach((field) => {
      if (formatStates.has(field)) values[field.name + formatSuffix] = JSON.stringify(formatStates.get(field));
    });
  }

  function wireNarratives(form, beforeEdit) {
    form.querySelectorAll(narrativeSelector).forEach((field) => {
      if (field.hidden) return;
      const readOnly = global.ReportData.readOnly;
      const row = labelRow(field);
      const label = row.querySelector("label");
      const editor = document.createElement("div");
      editor.className = "valuation-narrative";
      editor.contentEditable = String(!readOnly);
      editor.setAttribute("role", "textbox");
      editor.setAttribute("aria-multiline", "true");
      editor.setAttribute("aria-required", String(field.required));
      editor.setAttribute("aria-readonly", String(readOnly));
      label.id = field.id + "-narrative-label";
      editor.setAttribute("aria-labelledby", label.id);
      field.hidden = true;
      field.after(editor);
      if (!readOnly) label.addEventListener("click", () => editor.focus());
      paint(editor, field);
      if (readOnly) return;

      const toolbar = document.createElement("div");
      toolbar.className = "valuation-format-actions";
      toolbar.setAttribute("role", "group");
      toolbar.setAttribute("aria-label", label.textContent + " formatting");
      row.append(toolbar);
      const tools = [
        ["bold", "Bold", "M6 4h6a4 4 0 0 1 0 8H6z M6 12h7a4 4 0 0 1 0 8H6z"],
        ["insertUnorderedList", "Bulleted list", "M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01"],
        ["insertOrderedList", "Numbered list", "M10 6h10 M10 12h10 M10 18h10 M4 4h1v4 M3.5 8h3 M4 13a1.5 1.5 0 0 1 3 0c0 1-3 2.5-3 4h3"],
      ];
      let savedRange;
      function refreshToolbar() {
        const selection = window.getSelection();
        if (!selection.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return;
        savedRange = selection.getRangeAt(0).cloneRange();
        for (const button of toolbar.children) {
          button.setAttribute("aria-pressed", document.queryCommandState(button.dataset.command));
        }
      }
      function sync() {
        const blocks = readBlocks(editor);
        const value = plainText(blocks);
        const formatted = blocks.length > 1 || blocks.some(({ kind, runs }) =>
          kind !== "paragraph" || runs.some((run) => run.bold || run.text.includes("\n")));
        const previous = formatStates.get(field);
        if (value === field.value && JSON.stringify(previous) === JSON.stringify(formatted ? blocks : undefined)) return;
        if (formatted) formatStates.set(field, blocks);
        else formatStates.delete(field);
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      for (const [command, name, path] of tools) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "valuation-format-action";
        button.dataset.command = command;
        button.title = name;
        button.setAttribute("aria-label", name);
        button.setAttribute("aria-pressed", "false");
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"></path></svg>`;
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          if (field.disabled || !beforeEdit()) return;
          editor.focus();
          if (savedRange && editor.contains(savedRange.startContainer) && editor.contains(savedRange.endContainer)) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(savedRange);
          }
          document.execCommand(command);
          sync();
          refreshToolbar();
        });
        toolbar.append(button);
      }
      editor.addEventListener("beforeinput", (event) => {
        const unsupportedFormat = event.inputType?.startsWith("format") && event.inputType !== "formatBold";
        if (unsupportedFormat || field.disabled || !beforeEdit()) event.preventDefault();
      });
      editor.addEventListener("input", () => { sync(); refreshToolbar(); });
      editor.addEventListener("focusout", sync);
      editor.addEventListener("keyup", refreshToolbar);
      editor.addEventListener("pointerup", refreshToolbar);
      editor.addEventListener("paste", (event) => {
        event.preventDefault();
        if (!field.disabled && beforeEdit()) document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
      });
      editor.addEventListener("drop", (event) => event.preventDefault());
      editor.addEventListener("keydown", (event) => {
        if (event.key !== " " || event.isComposing || document.queryCommandState("insertOrderedList") ||
            document.queryCommandState("insertUnorderedList")) return;
        const selection = window.getSelection();
        if (!selection.isCollapsed || selection.anchorNode?.nodeType !== Node.TEXT_NODE) return;
        const node = selection.anchorNode;
        const line = node.parentElement.closest("div, p");
        if (!line || !editor.contains(line)) return;
        const before = document.createRange();
        before.selectNodeContents(line);
        before.setEnd(node, selection.anchorOffset);
        const marker = before.toString();
        if (marker !== "1." && marker !== "-") return;
        event.preventDefault();
        if (field.disabled || !beforeEdit()) return;
        selection.removeAllRanges();
        selection.addRange(before);
        document.execCommand("delete");
        document.execCommand(marker === "1." ? "insertOrderedList" : "insertUnorderedList");
        sync();
        refreshToolbar();
      });
      // The visible editor proxies validity and examples for the existing textarea.
      field.addEventListener("invalid", () => editor.setAttribute("aria-invalid", "true"));
      field.addEventListener("input", () => editor.removeAttribute("aria-invalid"));
    });
  }

  global.ValuationWriting = {
    installAddress, restoreField, restoreFormatting, collectFormatting, wireNarratives,
    narrativeFor: (field) => field.parentElement?.querySelector(".valuation-narrative"),
  };
})(window);
