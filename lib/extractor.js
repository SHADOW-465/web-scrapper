/*
 * Scrape Studio page engine. Plain browser JavaScript, no build step.
 *
 * Injected in two places from one source:
 *   1. the sandboxed page snapshot the user sees, where it detects lists,
 *      highlights columns, and turns clicks into columns (picker mode);
 *   2. the server's headless browser, where it re-runs a saved recipe on
 *      every page of a crawl (extract mode).
 *
 * How detection works, in the tradition of Instant Data Scraper: find parents
 * whose children repeat with the same tag and class signature, align each
 * child's text, links, and images by their path inside the child, and keep the
 * paths most children share. Each path is a column; each child is a row.
 */
(function () {
  "use strict";
  if (window.__ss) return;

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, HEAD: 1, SELECT: 1, OPTION: 1, IFRAME: 1, CANVAS: 1, PATH: 1 };
  var STATE_CLASS = /^(active|selected|current|odd|even|first|last|open|closed|hover|focus|visible|hidden|show|is-.*|has-.*|js-.*|ng-.*|swiper-slide-.*|Mui-(selected|focused|expanded|checked|disabled))$/;
  var HASHED = /^(css|sc|jsx|mui|emotion|svelte|tw)-[a-z0-9]{4,}$|^[a-zA-Z]{1,3}[0-9][a-zA-Z0-9]{4,}$|^_[a-zA-Z0-9]{5,}$/;
  var SEMANTIC = [
    [/(^|[-_ ])(company|organi[sz]ation|org|firm|exhibitor|brand|publisher|vendor)([-_ ]|$)/i, "Company"],
    [/(^|[-_ ])(position|designation|job|role|occupation)([-_ ]|$)/i, "Designation"],
    [/(^|[-_ ])(full-?name|name|person|member|speaker|author)([-_ ]|$)/i, "Name"],
    [/(^|[-_ ])(title|headline|heading)([-_ ]|$)/i, "Title"],
    [/(^|[-_ ])(country|nation)([-_ ]|$)/i, "Country"],
    [/(^|[-_ ])(city|town|location|region|place)([-_ ]|$)/i, "Location"],
    [/(^|[-_ ])(address|street)([-_ ]|$)/i, "Address"],
    [/(^|[-_ ])(hall)([-_ ]|$)/i, "Hall"],
    [/(^|[-_ ])(stand|booth)([-_ ]|$)/i, "Stand"],
    [/(^|[-_ ])(price|cost|amount|fee)([-_ ]|$)/i, "Price"],
    [/(^|[-_ ])(date|time|when|published|posted)([-_ ]|$)/i, "Date"],
    [/(^|[-_ ])(email|e-mail|mail)([-_ ]|$)/i, "Email"],
    [/(^|[-_ ])(phone|tel|mobile)([-_ ]|$)/i, "Phone"],
    [/(^|[-_ ])(desc|description|summary|about|bio|excerpt|abstract)([-_ ]|$)/i, "Description"],
    [/(^|[-_ ])(category|categories|genre|type|tag|tags|topic)([-_ ]|$)/i, "Category"],
    [/(^|[-_ ])(rating|score|stars|review)([-_ ]|$)/i, "Rating"],
    [/(^|[-_ ])(logo|avatar|photo|image|img|thumb|thumbnail|picture)([-_ ]|$)/i, "Image"],
    [/(^|[-_ ])(website|homepage|url)([-_ ]|$)/i, "Website"],
    [/(^|[-_ ])(sku|isbn|code|ref|reference)([-_ ]|$)/i, "Code"]
  ];
  var NEXT_WORDS = /^(next|next page|›|»|>|→|›|weiter|nächste|nächste seite|suivant|siguiente|próxima|avanti|volgende|następna|dalej)$/i;
  var MORE_WORDS = /^(load more|show more|more results|see more|view more|mehr laden|mehr anzeigen|weitere laden|plus de résultats|cargar más|ver más)$/i;

  function isUi(el) { return el.closest && el.closest("[data-ss-ui]"); }

  function classesOf(el) {
    var out = [];
    var list = el.classList || [];
    for (var i = 0; i < list.length && out.length < 3; i++) {
      var c = list[i];
      if (!STATE_CLASS.test(c) && !/^ss-/.test(c) && c.length < 60) out.push(c);
    }
    return out.sort();
  }

  function sig(el) { return el.tagName + "." + classesOf(el).join("."); }

  function cssEscape(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }

  function stepSelector(el) {
    var tag = el.tagName.toLowerCase();
    var cls = classesOf(el);
    var sel = tag + cls.map(function (c) { return "." + cssEscape(c); }).join("");
    var parent = el.parentElement;
    if (parent) {
      var same = 0, index = 0, sameTag = 0;
      for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c.tagName !== el.tagName) continue;
        sameTag++;
        if (c === el) index = sameTag;
        if (sig(c) === sig(el)) same++;
      }
      if (same > 1) sel += ":nth-of-type(" + index + ")";
    }
    return sel;
  }

  /** Selector for `el` relative to `root`, e.g. "div.card-body > span.name". */
  function relPath(root, el) {
    var steps = [];
    var cur = el;
    while (cur && cur !== root) {
      steps.unshift(stepSelector(cur));
      cur = cur.parentElement;
    }
    return steps.join(" > ");
  }

  /** A document-level selector for `el`, anchored on the nearest trustworthy id. */
  function absPath(el) {
    var steps = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id && !HASHED.test(cur.id) && !/\d{3,}/.test(cur.id) && document.querySelectorAll("#" + cssEscape(cur.id)).length === 1) {
        steps.unshift("#" + cssEscape(cur.id));
        break;
      }
      steps.unshift(cur === document.body ? "body" : stepSelector(cur));
      cur = cur.parentElement;
    }
    return steps.join(" > ");
  }

  function ownText(el) {
    var t = "";
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, " ").trim();
  }

  function fullText(el) { return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(); }

  function visible(el) {
    if (!el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  }

  function absUrl(v) { try { return new URL(v, document.baseURI).href; } catch (e) { return v || ""; } }

  function readValue(el, attr) {
    if (!el) return "";
    if (attr === "href") return el.getAttribute("href") ? absUrl(el.getAttribute("href")) : "";
    if (attr === "src") {
      var src = el.currentSrc || el.getAttribute("src") || el.getAttribute("data-src") || "";
      return src && src.indexOf("data:") !== 0 ? absUrl(src) : "";
    }
    if (attr === "own") return ownText(el) || (el.children.length ? "" : fullText(el));
    return fullText(el);
  }

  /* ------------------------------------------------------------ fields */

  function collectLeaves(item) {
    var leaves = [];
    var walker = document.createTreeWalker(item, NodeFilter.SHOW_ELEMENT, null);
    var el = item;
    while (el) {
      if (!SKIP_TAGS[el.tagName.toUpperCase()] && !isUi(el)) {
        var tag = el.tagName;
        if (tag === "IMG") {
          var src = readValue(el, "src");
          if (src) leaves.push({ el: el, attr: "src", value: src });
        } else if (tag === "A" && el.getAttribute("href") && !/^(#|javascript:)/i.test(el.getAttribute("href"))) {
          leaves.push({ el: el, attr: "href", value: readValue(el, "href") });
        }
        var own = ownText(el);
        if (own && /[\p{L}\p{N}]/u.test(own)) leaves.push({ el: el, attr: "own", value: own });
      }
      el = walker.nextNode();
    }
    return leaves;
  }

  function tableHeaders(item) {
    if (item.tagName !== "TR") return null;
    var table = item.closest("table");
    if (!table) return null;
    var head = table.querySelector("thead tr") || table.querySelector("tr");
    if (!head || head === item) return null;
    var cells = head.querySelectorAll("th, td");
    var names = [];
    for (var i = 0; i < cells.length; i++) names.push(fullText(cells[i]));
    return names.some(Boolean) ? names : null;
  }

  var TYPE_TESTS = [
    [/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i, "Email"],
    [/^\+?[\d\s().\-]{7,}$/, "Phone"],
    [/^(https?:)?\/\//i, "Website"],
    [/^[$€£¥₹]\s?\d|^\d[\d.,]*\s?(€|\$|£|eur|usd|gbp|inr)$/i, "Price"],
    [/^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$|^\d{1,2}\s\w{3,9}\.?\s\d{4}$|^\w{3,9}\s\d{1,2},?\s\d{4}$/i, "Date"],
    [/^[\d.,]+%?$/, "Number"]
  ];

  function humanize(s) {
    s = String(s || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return "";
    s = s.toLowerCase();
    return s[0].toUpperCase() + s.slice(1);
  }

  function hintFrom(el, stop) {
    var cur = el;
    while (cur && cur !== stop) {
      var direct = cur.getAttribute("data-testid") || cur.getAttribute("itemprop") || cur.getAttribute("data-field") || cur.getAttribute("data-label");
      if (direct && direct.length < 40) {
        var word = direct.replace(/^(team|card|item|list|row|cell|col|data)(?=[A-Z_-])/i, "");
        for (var j = 0; j < SEMANTIC.length; j++) if (SEMANTIC[j][0].test(humanize(word).replace(/ /g, "-"))) return SEMANTIC[j][1];
        return humanize(word);
      }
      var cls = (cur.getAttribute("class") || "") + " " + (cur.getAttribute("data-styleid") || "");
      var tokens = cls.split(/\s+/).filter(function (t) { return t && !HASHED.test(t); }).join(" ");
      for (var i = 0; i < SEMANTIC.length; i++) if (SEMANTIC[i][0].test(tokens)) return SEMANTIC[i][1];
      cur = cur.parentElement;
      if (cur && cur !== stop && cur.children.length > 3) break; // left the field's own wrapper
    }
    return "";
  }

  var WEAK_LABEL = /^(by|from|at|in|on|of|and|or|with|via|for|to|the|a|an|–|-|·|\|)$/i;

  function nameColumn(col, items, headers) {
    if (headers && col.cellIndex != null && headers[col.cellIndex]) return headers[col.cellIndex];
    // "Country:" printed before a value is the page naming it; trust that first.
    if (col.label && col.labelStrong) return col.label;
    var hint = hintFrom(col.sampleEl, col.sampleItem);
    if (!hint && col.label && !WEAK_LABEL.test(col.label)) return col.label;
    if (col.multi && !hint) hint = "Tags";
    if (col.attr === "src") return hint === "Image" || !hint ? "Image" : hint + " image";
    if (col.attr === "href") return hint && hint !== "Website" ? hint + " link" : "Link";
    if (hint) return hint;
    var vals = col.values.filter(Boolean);
    for (var t = 0; t < TYPE_TESTS.length; t++) {
      var re = TYPE_TESTS[t][0];
      if (vals.length && vals.filter(function (v) { return re.test(v); }).length >= vals.length * 0.8) return TYPE_TESTS[t][1];
    }
    var tag = col.sampleEl.tagName;
    if (/^H[1-6]$/.test(tag) || tag === "STRONG" || tag === "B") return "Title";
    var size = parseFloat(getComputedStyle(col.sampleEl).fontSize) || 0;
    if (size >= 17) return "Title";
    var avg = vals.reduce(function (a, v) { return a + v.length; }, 0) / (vals.length || 1);
    if (avg > 90) return "Description";
    return "Text";
  }

  function uniqueNames(cols) {
    var seen = {};
    cols.forEach(function (c) {
      var base = c.name, n = seen[base] || 0;
      seen[base] = n + 1;
      if (n) c.name = base + " " + (n + 1);
    });
  }

  /** Align every item's leaves by path; paths most items share become columns. */
  function buildColumns(items) {
    var byKey = {};
    var order = [];
    var headers = tableHeaders(items[0]);
    items.forEach(function (item, row) {
      collectLeaves(item).forEach(function (leaf) {
        var path = relPath(item, leaf.el);
        var key = path + "@" + leaf.attr;
        var col = byKey[key];
        if (!col) {
          col = byKey[key] = { key: key, sel: path, attr: leaf.attr, values: new Array(items.length).fill(""), hits: 0, sampleEl: leaf.el, sampleItem: item };
          order.push(key);
          if (headers) {
            var cell = leaf.el.closest("td, th");
            if (cell && cell.parentElement === item) col.cellIndex = Array.prototype.indexOf.call(item.children, cell);
          }
        }
        if (!col.values[row]) {
          col.values[row] = leaf.value;
          col.hits++;
        }
      });
    });

    // Repeated siblings inside one record (tags, authors, phone numbers) arrive
    // as ...:nth-of-type(1), (2), (3). They are one column holding a list.
    var merged = {};
    var mergedOrder = [];
    order.forEach(function (k) {
      var c = byKey[k];
      var base = c.sel.replace(/:nth-of-type\(\d+\)$/, "");
      var mk = base + "@" + c.attr;
      var m = merged[mk];
      if (!m) {
        merged[mk] = { key: mk, sel: base, attr: c.attr, parts: [c], sampleEl: c.sampleEl, sampleItem: c.sampleItem, cellIndex: c.cellIndex };
        mergedOrder.push(mk);
      } else m.parts.push(c);
    });
    var cols0 = mergedOrder.map(function (mk) {
      var m = merged[mk];
      if (m.parts.length === 1) return m.parts[0];
      var values = items.map(function (_, row) {
        return m.parts.map(function (p) { return p.values[row]; }).filter(Boolean).join(", ");
      });
      var hits = values.filter(Boolean).length;
      return { key: m.key, sel: m.sel, attr: m.attr, multi: true, values: values, hits: hits, sampleEl: m.sampleEl, sampleItem: m.sampleItem, cellIndex: m.cellIndex };
    });

    var minHits = items.length === 1 ? 1 : Math.max(2, Math.ceil(items.length * 0.25));
    var cols = cols0.filter(function (c) { return c.hits >= minHits; });

    // A value identical on every row is a label ("Country:"), not data. Use it
    // to name the column that follows it, then drop it.
    var kept = [];
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var distinct = {};
      c.values.forEach(function (v) { distinct[v] = 1; });
      var isConst = items.length > 2 && Object.keys(distinct).length === 1 && c.attr === "own";
      if (isConst) {
        var strong = /[:：]\s*$/.test(c.values[0]);
        var label = c.values[0].replace(/[:：]\s*$/, "");
        // A printed label names the next piece of text, not the link beside it.
        var target = null;
        for (var j = i + 1; j < cols.length && j <= i + 3; j++) if (cols[j].attr === "own") { target = cols[j]; break; }
        if (label.length <= 30 && target && !target.label) {
          target.label = label;
          target.labelStrong = strong;
        }
        continue;
      }
      kept.push(c);
    }

    // Drop exact duplicates (same values under two paths).
    var fingerprints = {};
    kept = kept.filter(function (c) {
      var fp = c.attr.replace("own", "text") + "|" + c.values.join("");
      if (fingerprints[fp]) return false;
      fingerprints[fp] = 1;
      return true;
    });

    kept.forEach(function (c) { c.name = nameColumn(c, items, headers); });
    uniqueNames(kept);
    return kept.map(function (c) {
      return { key: c.key, sel: c.sel, attr: c.attr, multi: !!c.multi, name: c.name, values: c.values, fill: c.hits / items.length };
    });
  }

  /* ------------------------------------------------------------ lists */

  function inChrome(el) {
    return !!el.closest("nav, header, footer, aside, [role=navigation], [role=menu], [role=menubar], [role=tablist], [aria-hidden=true], [data-ss-ui]");
  }

  /** The last visible heading before the list's first row, wherever it sits. */
  function precedingHeading(firstItem) {
    var all = document.querySelectorAll("h1, h2, h3, h4, [role=heading]");
    var best = "";
    for (var i = 0; i < all.length; i++) {
      var h = all[i];
      if (!(h.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      if (inChrome(h) || !visible(h) || h.contains(firstItem)) continue;
      var t = fullText(h);
      if (t && t.length < 80) best = t;
    }
    return best;
  }

  var lists = [];
  var nextId = 1;

  function describe(list) {
    return {
      id: list.id, name: list.name, count: list.items.length, itemSelector: list.itemSelector,
      columns: list.columns, score: list.score, manual: !!list.manual
    };
  }

  function makeList(items, parent, manual) {
    var childSig = items[0].tagName.toLowerCase() + classesOf(items[0]).map(function (c) { return "." + cssEscape(c); }).join("");
    var itemSelector = items.length === 1 && items[0] === document.body ? "body" : absPath(parent) + " > " + childSig;
    var columns = buildColumns(items);
    var heading = items.length === 1 ? "Details on this page" : precedingHeading(items[0]) || document.title || "List";
    return {
      id: "l" + nextId++, items: items, parent: parent, itemSelector: itemSelector, columns: columns,
      name: heading, score: 0, manual: !!manual
    };
  }

  function detect() {
    var candidates = [];
    var parents = document.body ? document.body.querySelectorAll("*") : [];
    for (var p = -1; p < parents.length; p++) {
      var parent = p < 0 ? document.body : parents[p];
      if (!parent || SKIP_TAGS[parent.tagName.toUpperCase()] || parent.children.length < 3 || isUi(parent)) continue;
      var groups = {};
      for (var i = 0; i < parent.children.length; i++) {
        var ch = parent.children[i];
        if (SKIP_TAGS[ch.tagName.toUpperCase()]) continue;
        var s = sig(ch);
        (groups[s] = groups[s] || []).push(ch);
      }
      for (var g in groups) {
        var items = groups[g].filter(visible);
        if (items.length < 3) continue;
        var sample = items.slice(0, 25);
        var textLen = 0, leafCount = 0, area = 0;
        sample.forEach(function (it) {
          var t = fullText(it);
          textLen += Math.min(t.length, 400);
          leafCount += Math.min(collectLeaves(it).length, 30);
          var r = it.getBoundingClientRect();
          area += r.width * r.height;
        });
        var avgText = textLen / sample.length;
        var avgLeaves = leafCount / sample.length;
        if (avgText < 2 && avgLeaves < 1) continue;
        var penalty = inChrome(parent) ? 0.15 : 1;
        if (avgLeaves <= 2 && avgText < 25) penalty *= 0.35; // menus, pagers, tag clouds
        var score = Math.pow(items.length, 0.6) * Math.log(avgText + 3) * Math.min(avgLeaves, 12) *
          Math.sqrt(area / sample.length + 1) * penalty;
        candidates.push({ items: items, parent: parent, score: score });
      }
    }
    candidates.sort(function (a, b) { return b.score - a.score; });

    // The same list is often detected at two wrapper depths; keep the best one.
    var chosen = [];
    candidates.forEach(function (c) {
      var dup = chosen.some(function (k) {
        if (k.items.length !== c.items.length) {
          // items that all sit inside a single row of a stronger list are sub-lists (tags, icons)
          var host = k.items.find(function (it) { return it.contains(c.parent); });
          return !!host && c.items.length < 8;
        }
        return k.items.every(function (it, i) { return it.contains(c.items[i]) || c.items[i].contains(it); });
      });
      if (!dup && chosen.length < 8) chosen.push(c);
    });

    lists = [];
    chosen.forEach(function (c) {
      var list = makeList(c.items, c.parent, false);
      list.score = c.score;
      if (list.columns.length) lists.push(list);
    });
    return lists.map(describe);
  }

  /** The element that repeats with its siblings, walking up from `el`. */
  function repeatingAncestor(el) {
    // Every level that repeats is a candidate; the one repeating most is the
    // record (a card among 36), not a detail inside it (two spans in one card).
    // Ties go to the outer level, which carries more of the record.
    var best = null;
    var cur = el;
    while (cur && cur.parentElement && cur !== document.body) {
      var parent = cur.parentElement;
      var s = sig(cur);
      var same = Array.prototype.filter.call(parent.children, function (c) { return sig(c) === s && visible(c); });
      if (same.length >= 2 && (!best || same.length >= best.items.length)) best = { items: same, parent: parent };
      cur = parent;
    }
    return best;
  }

  /* ------------------------------------------------------------ extract */

  function query(item, sel) {
    if (!sel) return item;
    try { return item.querySelector(":scope > " + sel); } catch (e) { return null; }
  }

  function queryAll(item, sel) {
    if (!sel) return [item];
    try { return Array.prototype.slice.call(item.querySelectorAll(":scope > " + sel)); } catch (e) { return []; }
  }

  function readField(item, f) {
    if (!f.multi) return readValue(query(item, f.sel), f.attr);
    return queryAll(item, f.sel).map(function (el) { return readValue(el, f.attr); }).filter(Boolean).join(", ");
  }

  /** Run a recipe: rows of { [columnName]: value }. Used on every crawled page. */
  function extract(recipe) {
    var items;
    try { items = document.querySelectorAll(recipe.itemSelector); } catch (e) { items = []; }
    var rows = [];
    for (var i = 0; i < items.length; i++) {
      var row = {}, any = false;
      recipe.fields.forEach(function (f) {
        var v = readField(items[i], f);
        row[f.name] = v;
        if (v) any = true;
      });
      if (any) rows.push(row);
    }
    return rows;
  }

  function findNext() {
    var els = document.querySelectorAll("a, button, [role=button], input[type=button], input[type=submit]");
    var best = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!visible(el) || isUi(el) || el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      // "Next →", "» Next", "Weiter ›": judge the words, not the arrows.
      var text = (fullText(el) || el.value || "").replace(/[→›»>←‹«<]+/g, " ").replace(/\s+/g, " ").trim();
      if (!text && /[→›»>]/.test(fullText(el))) text = "›";
      var aria = ((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "")).toLowerCase();
      var kind = null;
      if (el.getAttribute("rel") === "next" || NEXT_WORDS.test(text) || /\bnext\b|nächste|suivant|siguiente/.test(aria)) kind = "next";
      else if (MORE_WORDS.test(text)) kind = "more";
      if (kind && (!best || kind === "next")) best = { selector: absPath(el), kind: kind, label: text || aria.trim() || "Next" };
      if (best && best.kind === "next") break;
    }
    return best;
  }

  /**
   * Freeze the live page into inert HTML: no scripts, no handlers, every URL
   * absolute. Runs in the server browser just before the snapshot is taken.
   */
  function sanitize() {
    function abs(v) { try { return new URL(v, document.baseURI).href; } catch (e) { return v; } }
    document.querySelectorAll("img").forEach(function (img) {
      var lazy = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-original");
      var src = img.getAttribute("src") || "";
      if (lazy && (!src || src.indexOf("data:") === 0)) img.setAttribute("src", lazy);
      if (img.currentSrc) img.setAttribute("src", img.currentSrc);
      img.removeAttribute("srcset");
      img.removeAttribute("loading");
    });
    document.querySelectorAll("input, textarea").forEach(function (i) { i.setAttribute("value", i.value); });
    document.querySelectorAll("details").forEach(function (d) { d.setAttribute("open", ""); });
    document.querySelectorAll("script, noscript, iframe, object, embed, frame, frameset, link[rel=preload], link[rel=modulepreload], link[rel=prefetch], link[rel=manifest], meta[http-equiv], base").forEach(function (el) { el.remove(); });
    document.querySelectorAll("*").forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase();
        if (n.indexOf("on") === 0 || n === "srcdoc" || n === "formaction" || n === "ping") el.removeAttribute(a.name);
        else if (/^(href|src|action|poster|xlink:href)$/.test(n)) {
          if (/^\s*(javascript|vbscript):/i.test(a.value)) el.removeAttribute(a.name);
          else if (a.value && n !== "action") el.setAttribute(a.name, abs(a.value));
        }
      });
    });
    return "<!doctype html>" + document.documentElement.outerHTML;
  }

  window.__ss = { detect: detect, extract: extract, findNext: findNext, sanitize: sanitize, version: 1 };

  /* ============================================================ picker */

  if (!window.__SS_PICKER__) return;

  var active = null;
  var painted = {};
  var tip = null, hoverBox = null;

  function post(msg) { parent.postMessage(Object.assign({ source: "scrape-studio" }, msg), "*"); }

  function ensureUi() {
    if (tip) return;
    var style = document.createElement("style");
    style.setAttribute("data-ss-ui", "");
    style.textContent =
      "[data-ss-item]{outline:1.5px dashed rgba(29,31,34,.28)!important;outline-offset:3px!important}" +
      "[data-ss-item].ss-first{outline:2px dashed rgba(29,31,34,.55)!important}" +
      // Highlighter ink: a flat fill that bleeds 2px past the text, multiplied
      // over the paper so the words stay legible underneath.
      "[data-ss-mark]{background-image:linear-gradient(var(--ss-ink),var(--ss-ink))!important;background-repeat:no-repeat!important;background-size:100% 100%!important;box-shadow:0 0 0 2px var(--ss-ink)!important;border-radius:1px 3px 2px 3px!important;mix-blend-mode:multiply;color:#16181b!important;-webkit-box-decoration-break:clone;box-decoration-break:clone}" +
      "img[data-ss-mark]{background:none!important;box-shadow:none!important;outline:5px solid var(--ss-ink)!important;outline-offset:-1px;mix-blend-mode:normal}" +
      "[data-ss-new]{animation:ss-swipe .44s cubic-bezier(.16,1,.3,1) both}" +
      "@keyframes ss-swipe{from{background-size:0% 100%;box-shadow:0 0 0 0 transparent}60%{box-shadow:0 0 0 2px var(--ss-ink)}to{background-size:100% 100%}}" +
      "@media (prefers-reduced-motion:reduce){[data-ss-new],[data-ss-flash]{animation:none}}" +
      "[data-ss-flash]{animation:ss-flash .9s ease-out 1}" +
      "@keyframes ss-flash{0%{box-shadow:0 0 0 6px var(--ss-ink)}100%{box-shadow:0 0 0 2px var(--ss-ink)}}" +
      "html.ss-picking, html.ss-picking *{cursor:crosshair!important}" +
      "[data-ss-ui].ss-box{position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #16181b;border-radius:3px;background:rgba(247,231,51,.18);transition:all .06s linear}" +
      "[data-ss-ui].ss-tip{position:fixed;pointer-events:none;z-index:2147483647;font:600 12px/1.3 system-ui,sans-serif;background:#16181b;color:#fff;padding:5px 8px;border-radius:4px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}";
    document.head.appendChild(style);
    hoverBox = document.createElement("div");
    hoverBox.setAttribute("data-ss-ui", "");
    hoverBox.className = "ss-box";
    tip = document.createElement("div");
    tip.setAttribute("data-ss-ui", "");
    tip.className = "ss-tip";
    hoverBox.style.display = tip.style.display = "none";
    document.body.appendChild(hoverBox);
    document.body.appendChild(tip);
    document.documentElement.classList.add("ss-picking");
  }

  function listOf(el) {
    for (var i = 0; i < lists.length; i++) {
      var items = lists[i].items;
      for (var j = 0; j < items.length; j++) if (items[j].contains(el)) return { list: lists[i], item: items[j] };
    }
    return null;
  }

  function clearMarks() {
    document.querySelectorAll("[data-ss-item]").forEach(function (e) { e.removeAttribute("data-ss-item"); e.classList.remove("ss-first"); });
    document.querySelectorAll("[data-ss-mark]").forEach(function (e) { e.removeAttribute("data-ss-mark"); e.removeAttribute("data-ss-new"); e.style.removeProperty("--ss-ink"); });
  }

  function paint() {
    clearMarks();
    if (!active) return;
    active.items.forEach(function (it, i) {
      it.setAttribute("data-ss-item", "");
      if (!i) it.classList.add("ss-first");
    });
    Object.keys(painted).forEach(function (key) {
      var col = painted[key];
      active.items.forEach(function (it) {
        (col.multi ? queryAll(it, col.sel) : [query(it, col.sel)]).forEach(function (el) {
          if (!el) return;
          if (col.fresh && !el.hasAttribute("data-ss-mark")) el.setAttribute("data-ss-new", "");
          el.setAttribute("data-ss-mark", key);
          el.style.setProperty("--ss-ink", col.color);
        });
      });
    });
  }

  /** The element a click most plausibly means: the leaf carrying text or a link. */
  function resolveTarget(el) {
    if (el.tagName === "IMG") return { el: el, attr: "src" };
    var cur = el;
    for (var d = 0; d < 3 && cur && !ownText(cur); d++) {
      var withText = Array.prototype.filter.call(cur.children, function (c) { return fullText(c); });
      if (withText.length !== 1) break;
      cur = withText[0];
    }
    if (cur && ownText(cur)) return { el: cur, attr: "own" };
    var img = el.querySelector && el.querySelector("img");
    if (img && !fullText(el)) return { el: img, attr: "src" };
    return { el: el, attr: "text" };
  }

  function columnAt(list, item, target) {
    var sel = relPath(item, target.el);
    // Clicking one tag in a row of tags means "the tags", not "the third tag".
    var base = sel.replace(/:nth-of-type\(\d+\)$/, "");
    var multi = base !== sel && list.items.some(function (it) { return queryAll(it, base).length > 1; });
    if (multi) sel = base;
    var f = { sel: sel, attr: target.attr, multi: multi };
    var values = list.items.map(function (it) { return readField(it, f); });
    var col = { key: sel + "@" + target.attr, sel: sel, attr: target.attr, multi: multi, values: values,
      fill: values.filter(Boolean).length / values.length, sampleEl: target.el, sampleItem: item };
    col.name = nameColumn(col, list.items, tableHeaders(list.items[0]));
    return { key: col.key, sel: col.sel, attr: col.attr, multi: multi, name: col.name, values: col.values, fill: col.fill };
  }

  document.addEventListener("mousemove", function (e) {
    ensureUi();
    var el = e.target;
    if (!el || isUi(el) || el === document.documentElement || el === document.body) {
      hoverBox.style.display = tip.style.display = "none";
      return;
    }
    var target = resolveTarget(el);
    var r = target.el.getBoundingClientRect();
    hoverBox.style.display = tip.style.display = "block";
    hoverBox.style.left = r.left - 3 + "px";
    hoverBox.style.top = r.top - 3 + "px";
    hoverBox.style.width = r.width + 6 + "px";
    hoverBox.style.height = r.height + 6 + "px";
    var hit = listOf(target.el);
    var marked = target.el.getAttribute("data-ss-mark");
    tip.textContent = marked ? "Click to remove this column" :
      hit ? "Click to add as a column" + (hit.list === active ? "" : " (switches list)") : "Click to capture this";
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 270) + "px";
    tip.style.top = Math.min(e.clientY + 16, innerHeight - 30) + "px";
  }, true);

  function hideHover() { if (hoverBox) hoverBox.style.display = tip.style.display = "none"; }
  document.addEventListener("mouseleave", hideHover);
  // The box is fixed-position; a scroll would leave it behind on the wrong element.
  window.addEventListener("scroll", hideHover, true);

  function swallow(e) {
    if (isUi(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  ["mousedown", "mouseup", "pointerdown", "pointerup", "submit", "auxclick", "dblclick"].forEach(function (t) {
    document.addEventListener(t, swallow, true);
  });

  document.addEventListener("click", function (e) {
    swallow(e);
    var target = resolveTarget(e.target);
    var marked = target.el.closest("[data-ss-mark]");
    if (marked && active) {
      post({ type: "pick", listId: active.id, remove: marked.getAttribute("data-ss-mark") });
      return;
    }
    var hit = listOf(target.el);
    var created = null;
    if (!hit) {
      var rep = repeatingAncestor(target.el);
      var list = rep ? makeList(rep.items, rep.parent, true) : makeList([document.body], document.body.parentElement, true);
      lists.push(list);
      created = describe(list);
      hit = { list: list, item: rep ? rep.items.find(function (it) { return it.contains(target.el); }) : document.body };
    }
    post({ type: "pick", listId: hit.list.id, created: created, column: columnAt(hit.list, hit.item, target) });
  }, true);

  window.addEventListener("message", function (e) {
    var m = e.data || {};
    if (m.source !== "scrape-studio-host") return;
    if (m.type === "activate" || m.type === "paint") {
      active = lists.find(function (l) { return l.id === m.listId; }) || null;
      painted = {};
      (m.columns || []).forEach(function (c) { painted[c.key] = c; });
      paint();
      if (m.type === "activate" && active && m.scroll) active.items[0].scrollIntoView({ block: "center", behavior: "smooth" });
    } else if (m.type === "flash" && active) {
      document.querySelectorAll('[data-ss-mark="' + cssEscape(m.key) + '"]').forEach(function (el, i) {
        el.removeAttribute("data-ss-flash");
        void el.offsetWidth;
        el.setAttribute("data-ss-flash", "");
        if (!i && m.scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  });

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    ensureUi();
    var found = detect();
    post({ type: "ready", lists: found, next: findNext(), title: document.title });
  }
  // Layout needs the stylesheets, but a slow remote image must not stall detection.
  if (document.readyState === "complete") setTimeout(boot, 50);
  else {
    window.addEventListener("load", function () { setTimeout(boot, 50); });
    setTimeout(boot, 3500);
  }
})();
