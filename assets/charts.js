// Small dependency-free chart helpers: HTML horizontal bars, SVG columns and
// SVG lines, all with a shared hover tooltip. Colours come from CSS tokens.
window.Charts = (function () {
  const NS = "http://www.w3.org/2000/svg";
  let tipEl = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function tip() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "viz-tip";
      tipEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function showTip(html, x, y) {
    const t = tip();
    t.innerHTML = html;
    t.style.opacity = "1";
    const pad = 12;
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    let left = x + pad;
    let top = y - h - pad;
    if (left + w > window.innerWidth - 8) left = x - w - pad;
    if (left < 8) left = 8;
    if (top < 8) top = y + pad;
    t.style.left = left + "px";
    t.style.top = top + "px";
  }

  function hideTip() {
    if (tipEl) tipEl.style.opacity = "0";
  }

  function node(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // Round axis bounds outward to a 1/2/2.5/5 step so every tick is a clean number.
  function niceScale(lo, hi, target) {
    target = target || 4;
    const raw = (hi - lo) / target || 1;
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / exp;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
    const a = Math.floor(lo / step) * step;
    const b = Math.ceil(hi / step) * step;
    const out = [];
    for (let v = a; v <= b + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return { lo: a, hi: b, ticks: out };
  }

  // ------------------------------------------------------------ HTML bars
  // rows: [{label, value, prev?, valueText, tip?, over?}]
  // opts: {max?, ref? (value for a reference line), refLabel?}
  function hbars(container, rows, opts) {
    opts = opts || {};
    const max = opts.max || Math.max(...rows.map((r) => Math.max(r.value || 0, r.prev || 0, opts.ref || 0))) || 1;
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = opts.compact ? "hbars compact" : "hbars";
    rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "hbar-row";
      if (opts.labelWidth) row.style.gridTemplateColumns = `minmax(0, ${opts.labelWidth}px) minmax(0, 1fr) auto`;
      const w = Math.max(0, Math.min(100, ((r.value || 0) / max) * 100));
      let inner = `<div class="hbar-label">${esc(r.label)}</div><div class="hbar-track">`;
      inner += `<div class="hbar-fill${r.over ? " over" : ""}" style="width:${w}%"></div>`;
      if (r.prev != null && r.prev > 0) {
        const p = Math.min(100, (r.prev / max) * 100);
        inner += `<div class="hbar-prev" style="left:calc(${p}% - 1px)"></div>`;
      }
      if (opts.ref != null) {
        const p = Math.min(100, (opts.ref / max) * 100);
        inner += `<div class="hbar-ref" style="left:${p}%"></div>`;
      }
      inner += `</div><div class="hbar-value">${esc(r.valueText)}</div>`;
      row.innerHTML = inner;
      if (r.tip) {
        row.addEventListener("mousemove", (e) => showTip(r.tip, e.clientX, e.clientY));
        row.addEventListener("mouseleave", hideTip);
      }
      wrap.appendChild(row);
    });
    container.appendChild(wrap);
  }

  // ------------------------------------------------------------ SVG columns
  // points: [{x, y, tip}], opts: {fmtAxis, fmtValue, height, highlight: x[]}
  function columns(container, points, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!points.length) return;
    const W = Math.max(280, container.clientWidth || 600);
    const H = opts.height || 240;
    const m = { t: 22, r: 8, b: 26, l: 44 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const scale = niceScale(0, Math.max(...points.map((p) => p.y)));
    const max = scale.hi;
    const svg = node("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label || "" }, null);
    const g = node("g", { transform: `translate(${m.l},${m.t})` }, svg);
    scale.ticks.forEach((t) => {
      const y = ih - (t / max) * ih;
      node("line", { x1: 0, x2: iw, y1: y, y2: y, class: t === 0 ? "baseline" : "gridline" }, g);
      const tl = node("text", { x: -8, y: y + 4, "text-anchor": "end", class: "tick-label" }, g);
      tl.textContent = opts.fmtAxis ? opts.fmtAxis(t) : t;
    });
    const band = iw / points.length;
    const bw = Math.min(24, band * 0.6);
    const maxIdx = points.reduce((bi, p, i) => (p.y > points[bi].y ? i : bi), 0);
    points.forEach((p, i) => {
      const cx = band * i + band / 2;
      const h = (p.y / max) * ih;
      const x = cx - bw / 2;
      const y = ih - h;
      const r = Math.min(4, h, bw / 2);
      const d = `M${x},${ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${ih} Z`;
      const isHi = opts.highlight ? opts.highlight.includes(p.x) : i === points.length - 1;
      node("path", { d, fill: isHi ? "var(--series-1)" : "color-mix(in srgb, var(--series-1) 45%, var(--surface))" }, g);
      const xl = node("text", { x: cx, y: ih + 16, "text-anchor": "middle", class: "tick-label" }, g);
      xl.textContent = p.x;
      if (i === points.length - 1 || i === maxIdx || i === 0) {
        const vl = node("text", { x: cx, y: y - 6, "text-anchor": "middle", class: "val-label" }, g);
        vl.textContent = opts.fmtValue ? opts.fmtValue(p.y) : p.y;
      }
      const hit = node("rect", { x: band * i, y: 0, width: band, height: ih, fill: "transparent" }, g);
      hit.addEventListener("mousemove", (e) => showTip(p.tip || `${esc(p.x)}: ${esc(opts.fmtValue ? opts.fmtValue(p.y) : p.y)}`, e.clientX, e.clientY));
      hit.addEventListener("mouseleave", hideTip);
    });
    container.appendChild(svg);
  }

  // ------------------------------------------------------------ SVG lines
  // series: [{name, color, points: [{x, y}]}], opts: {fmtAxis, fmtValue, height, yMin (lower-bound hint, default 0)}
  function lines(container, series, opts) {
    opts = opts || {};
    container.innerHTML = "";
    const xs = series[0] ? series[0].points.map((p) => p.x) : [];
    if (!xs.length) return;
    const W = Math.max(280, container.clientWidth || 600);
    const H = opts.height || 240;
    const labelRoom = series.length <= 4 ? 64 : 8;
    const m = { t: 14, r: labelRoom, b: 26, l: 44 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const all = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v != null);
    const scale = niceScale(opts.yMin != null ? opts.yMin : 0, Math.max(...all));
    const yMax = scale.hi;
    const yMin = scale.lo;
    const sx = (i) => (xs.length === 1 ? iw / 2 : (i / (xs.length - 1)) * iw);
    const sy = (v) => ih - ((v - yMin) / (yMax - yMin)) * ih;
    const svg = node("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opts.label || "" }, null);
    const g = node("g", { transform: `translate(${m.l},${m.t})` }, svg);
    scale.ticks.forEach((t, i) => {
      const y = sy(t);
      node("line", { x1: 0, x2: iw, y1: y, y2: y, class: i === 0 ? "baseline" : "gridline" }, g);
      const tl = node("text", { x: -8, y: y + 4, "text-anchor": "end", class: "tick-label" }, g);
      tl.textContent = opts.fmtAxis ? opts.fmtAxis(t) : t;
    });
    xs.forEach((x, i) => {
      if (xs.length > 8 && i % 2 === 1 && i !== xs.length - 1) return;
      const xl = node("text", { x: sx(i), y: ih + 16, "text-anchor": "middle", class: "tick-label" }, g);
      xl.textContent = x;
    });
    const cross = node("line", { x1: 0, x2: 0, y1: 0, y2: ih, class: "crosshair", visibility: "hidden" }, g);
    const endYs = [];
    series.forEach((s) => {
      const d = s.points.map((p, i) => `${i ? "L" : "M"}${sx(i)},${sy(p.y)}`).join(" ");
      node("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
      const last = s.points[s.points.length - 1];
      node("circle", { cx: sx(s.points.length - 1), cy: sy(last.y), r: 4, fill: s.color, stroke: "var(--surface)", "stroke-width": 2 }, g);
      endYs.push({ y: sy(last.y), s, last });
    });
    if (series.length <= 4) {
      // direct end labels; nudge apart only by the minimum needed to avoid overlap
      endYs.sort((a, b) => a.y - b.y);
      for (let i = 1; i < endYs.length; i++) if (endYs[i].y - endYs[i - 1].y < 13) endYs[i].y = endYs[i - 1].y + 13;
      endYs.forEach((e) => {
        const t = node("text", { x: iw + 8, y: e.y + 4, class: "end-label" }, g);
        t.textContent = opts.fmtValue ? opts.fmtValue(e.last.y) : e.last.y;
      });
    }
    const dots = series.map((s) => node("circle", { r: 4, fill: s.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }, g));
    const hit = node("rect", { x: 0, y: 0, width: iw, height: ih, fill: "transparent" }, g);
    hit.addEventListener("mousemove", (e) => {
      const rect = hit.getBoundingClientRect();
      const rel = ((e.clientX - rect.left) / rect.width) * iw;
      const i = Math.max(0, Math.min(xs.length - 1, Math.round((rel / iw) * (xs.length - 1))));
      cross.setAttribute("x1", sx(i));
      cross.setAttribute("x2", sx(i));
      cross.setAttribute("visibility", "visible");
      let html = `<div class="t-title">${esc(xs[i])}</div>`;
      series.forEach((s, si) => {
        const p = s.points[i];
        dots[si].setAttribute("cx", sx(i));
        dots[si].setAttribute("cy", sy(p.y));
        dots[si].setAttribute("visibility", "visible");
        html += `<div class="t-row"><span class="k"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</span><span class="num">${esc(opts.fmtValue ? opts.fmtValue(p.y) : p.y)}</span></div>`;
      });
      showTip(html, e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", () => {
      cross.setAttribute("visibility", "hidden");
      dots.forEach((d) => d.setAttribute("visibility", "hidden"));
      hideTip();
    });
    container.appendChild(svg);
  }

  function legend(items) {
    return `<div class="legend">${items
      .map((it) => `<span class="key"><span class="sw ${it.kind || ""}" style="${it.color ? `background:${it.color}` : ""}"></span>${esc(it.label)}</span>`)
      .join("")}</div>`;
  }

  return { hbars, columns, lines, legend, showTip, hideTip, esc };
})();
