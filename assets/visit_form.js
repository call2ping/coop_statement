// Fill templates/visit_template.docx (สมุดบันทึกการเข้าร่วมประชุมใหญ่สหกรณ์) with one coop's analysis
// and download it. The template parts come from assets/visit_template.js (loaded on first use);
// the filled document is written as an uncompressed zip, so no library is needed.
(function () {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const CHECK = { pass: "☑", fail: "☒", unknown: "☐" };
  const TEMPLATE_SRC = "assets/visit_template.js?v=12";

  // ------------------------------------------------------------ zip (store only)
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  function zipStore(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    files.forEach(({ name, text }) => {
      const nameBytes = enc.encode(name);
      const data = enc.encode(text);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(8, 0, true); // stored
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    });
    const cenSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  }

  // ------------------------------------------------------------ docx helpers
  const XML_NS = "http://www.w3.org/XML/1998/namespace";
  const els = (node, tag) => Array.from(node.getElementsByTagNameNS(W, tag));
  const textOf = (node) => els(node, "t").map((t) => t.textContent).join("");
  const directChildren = (node, tag) => Array.from(node.childNodes).filter((n) => n.namespaceURI === W && n.localName === tag);

  // Replace a paragraph's runs with one run per line (joined by line breaks), keeping the first run's formatting.
  function setParagraph(doc, p, lines, size) {
    const runs = directChildren(p, "r");
    const proto = runs[0];
    const rPr = proto ? directChildren(proto, "rPr")[0] : null;
    runs.forEach((r) => p.removeChild(r));
    (Array.isArray(lines) ? lines : [lines]).forEach((line, i) => {
      const r = doc.createElementNS(W, "w:r");
      if (rPr) {
        const pr = rPr.cloneNode(true);
        if (size) {
          directChildren(pr, "sz").concat(directChildren(pr, "szCs")).forEach((s) => s.setAttributeNS(W, "w:val", String(size)));
        }
        r.appendChild(pr);
      }
      if (i > 0) r.appendChild(doc.createElementNS(W, "w:br"));
      const t = doc.createElementNS(W, "w:t");
      t.setAttributeNS(XML_NS, "xml:space", "preserve");
      t.textContent = line;
      r.appendChild(t);
      p.appendChild(r);
    });
  }

  function findParagraph(doc, test) {
    return els(doc, "p").find((p) => test(textOf(p))) || null;
  }

  // Fill the paragraphs of underscores that follow a heading; extra lines become extra paragraphs.
  function fillSection(doc, heading, lines) {
    const head = findParagraph(doc, (t) => t.trim() === heading);
    if (!head) return;
    const blanks = [];
    let n = head.nextSibling;
    while (n && n.localName === "p" && /^_+$/.test(textOf(n).trim())) {
      blanks.push(n);
      n = n.nextSibling;
    }
    if (!blanks.length) return;
    const proto = blanks[0];
    const body = proto.parentNode;
    const list = lines.length ? lines : ["–"];
    list.forEach((line) => {
      const p = proto.cloneNode(true);
      setParagraph(doc, p, line, 28);
      body.insertBefore(p, proto);
    });
    blanks.forEach((b) => body.removeChild(b));
  }

  // ------------------------------------------------------------ assessment
  function assess(c, A, fmt) {
    const { M, pct, spct, cnt, growth, refundText } = fmt;
    const val = A.val;
    const R = {};
    A.ratios.forEach((r) => (R[r.id] = r));
    const F = A.findings;
    const bench = (id) => (R[id] && R[id].benchmark != null ? R[id].benchmark : null);
    const num = (v, d = 2) => (v == null || !isFinite(v) ? "–" : v.toLocaleString("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d }));
    const borrow = ["st_borrow", "cur_ltb", "lt_borrow"].reduce((s, id) => s + (val(id, "y") || 0), 0);
    const loansY = (val("st_loans", "y") || 0) + (val("lt_loans", "y") || 0);
    const np = val("net_profit", "y");
    const npG = growth(np, val("net_profit", "py"));
    const eqG = growth(val("total_equity", "y"), val("total_equity", "py"));
    const shG = growth(val("shares", "y"), val("shares", "py"));
    const liabG = growth(val("total_liab", "y"), val("total_liab", "py"));
    const taG = growth(val("total_assets", "y"), val("total_assets", "py"));
    const m = c.members || {};
    const memG = m.total && m.prevTotal ? growth(m.total, m.prevTotal) : null;
    const h = c.history && c.history.length ? c.history[c.history.length - 1] : null;
    const L = c.litigation || { cases: [] };
    const cases = L.cases || [];
    const ongoing = cases.filter((x) => x.status === "ongoing");
    const accused = ongoing.filter((x) => /จำเลย|ผู้ถูกกล่าวหา|ผู้ถูกร้อง/.test(x.role || ""));
    const unqualified = /ไม่มีเงื่อนไข/.test(c.report.opinion || "");
    const noDisclosureSection = /ไม่มีหัวข้อการถูกร้องทุกข์/.test(L.disclosure || "");
    const cr = R.current_ratio;
    const pl = R.problem_loans;

    // checklist: label in the template → [state, note]
    const checks = {};
    checks["ได้รับรายงานประจำปี"] = ["pass", `${c.report.title} ปีบัญชีสิ้นสุด ${c.report.fiscalYearEnd}`];
    checks["กรรมการ/ผู้จัดการเปลี่ยนแปลง"] = ["unknown", "งบการเงินไม่มีข้อมูล สอบถามในที่ประชุม"];
    checks["สมาชิกเพิ่ม/ลด"] = m.total
      ? [memG == null || memG >= 0 ? "pass" : "fail", `${cnt(m.total)} คน (${memG == null ? "ไม่มีข้อมูลปีก่อน" : spct(memG)})`]
      : ["unknown", "รายงานไม่ระบุจำนวนสมาชิก"];
    checks["กำไรสุทธิ"] = [np > 0 && (npG == null || npG > -10 || c.profitContext) ? "pass" : "fail",
      `${M(np)} (${spct(npG)} จากปีก่อน)${c.profitContext && npG < 0 ? " มีเหตุพิเศษ ดูหมายเหตุ" : ""}`];
    checks["สภาพคล่องดี"] = cr
      ? [bench("current_ratio") == null || cr.y >= bench("current_ratio") ? "pass" : "fail",
        `ทุนหมุนเวียน ${num(cr.y)} เท่า (เฉลี่ย ${num(bench("current_ratio"))})${R.liquid_dep ? ` สภาพคล่อง ${pct(R.liquid_dep.y)} ของเงินฝาก` : ""}`]
      : ["unknown", "–"];
    checks["ทุนเพิ่ม"] = [eqG > 0 ? "pass" : "fail", `ทุนของสหกรณ์ ${spct(eqG)} ทุนเรือนหุ้น ${spct(shG)}`];
    checks["หนี้ไม่เพิ่มผิดปกติ"] = [liabG == null || liabG <= Math.max((taG || 0) + 5, 15) ? "pass" : "fail",
      `หนี้สินรวม ${spct(liabG)} (สินทรัพย์ ${spct(taG)})${borrow ? ` เงินกู้ยืม ${M(borrow)}` : " ไม่มีเงินกู้ยืม"}`];
    checks["ชำระหนี้ตรงเวลา"] = borrow
      ? ["unknown", `มีเงินกู้ยืม ${M(borrow)} ตรวจประวัติชำระกับสหกรณ์ผู้ให้กู้`]
      : ["pass", "ไม่มีเงินกู้ยืมคงค้าง ณ สิ้นปี"];
    checks["ไม่มีผิดนัด"] = pl && pl.y != null && isFinite(pl.y)
      ? [pl.y < 1 ? "pass" : "fail", `ลูกหนี้มีปัญหา ${pct(pl.y)} ของเงินให้กู้ (ปีก่อน ${pct(pl.py)})`]
      : ["unknown", "งบหลักไม่แยกลูกหนี้ผิดนัด"];
    checks["มีแผนบริหารเงินสด"] = c.creditLines && c.creditLines.length
      ? ["pass", `มีวงเงินกู้สำรอง ${c.creditLines.length} แหล่ง`]
      : ["unknown", R.liquid_dep ? `สภาพคล่อง ${pct(R.liquid_dep.y)} ของเงินฝาก สอบถามแผนในที่ประชุม` : "สอบถามในที่ประชุม"];
    checks["ผู้สอบบัญชีไม่มีเงื่อนไข"] = [unqualified ? "pass" : "fail", `${c.report.opinion || "–"}${c.report.auditDate ? ` ลงวันที่ ${c.report.auditDate}` : ""}`];
    checks["ไม่มีคดีสำคัญ"] = accused.length
      ? ["fail", `มีคดีที่สหกรณ์เป็นผู้ถูกฟ้อง/ถูกกล่าวหา ${accused.length} เรื่อง`]
      : ["pass", cases.length ? `คดีที่เกี่ยวข้อง ${cases.length} เรื่อง (ยังไม่สิ้นสุด ${ongoing.length}) ไม่มีคดีที่สหกรณ์ถูกฟ้องค้างอยู่` : "ไม่พบคดีในรายงานและการค้นหา"];
    checks["เปิดเผยข้อมูล"] = noDisclosureSection
      ? ["unknown", "เผยแพร่รายงานบนเว็บไซต์ แต่ไม่มีหัวข้อร้องทุกข์/คดีตามกฎกระทรวงฯ ข้อ 14(2)"]
      : ["pass", "เผยแพร่รายงานบนเว็บไซต์และเปิดเผยเรื่องร้องเรียน/คดี"];

    // scores: 5 = แข็งแรง/ความเสี่ยงต่ำ, 1 = ความเสี่ยงสูง
    const clamp = (v) => Math.max(1, Math.min(5, v));
    const scores = [];
    {
      let s = 3;
      const de = R.de_ratio, roa = R.roa;
      if (de && bench("de_ratio") != null) s += de.y <= bench("de_ratio") ? 1 : de.y > bench("de_ratio") * 1.5 ? -1 : 0;
      if (roa && bench("roa") != null) s += roa.y >= bench("roa") ? 1 : roa.y < bench("roa") * 0.7 ? -1 : 0;
      if (eqG != null && eqG < 0) s -= 1;
      scores.push(["ฐานะการเงิน", clamp(s), `D/E ${num(de && de.y)} เท่า (เฉลี่ย ${num(bench("de_ratio"))}) ROA ${pct(roa && roa.y)} (เฉลี่ย ${pct(bench("roa"))})`]);
    }
    {
      let s = 3;
      const b = bench("current_ratio");
      if (cr && b != null) s = cr.y >= b ? 5 : cr.y >= b * 0.75 ? 4 : cr.y >= b * 0.5 ? 3 : cr.y >= b * 0.3 ? 2 : 1;
      scores.push(["สภาพคล่อง", s, `ทุนหมุนเวียน ${num(cr && cr.y)} เท่า (เฉลี่ย ${num(b)})`]);
    }
    {
      let s = 3, basis = "ไม่มีข้อมูลลูกหนี้มีปัญหา ให้คะแนนกลาง";
      if (pl && pl.y != null && isFinite(pl.y)) {
        s = pl.y < 0.5 ? 5 : pl.y < 1 ? 4 : pl.y < 3 ? 3 : pl.y < 5 ? 2 : 1;
        basis = `ลูกหนี้มีปัญหา ${pct(pl.y)} ของเงินให้กู้`;
      }
      const debtShare = val("total_assets", "y") ? (borrow / val("total_assets", "y")) * 100 : 0;
      if (debtShare > 20) { s -= 1; basis += ` เงินกู้ยืม ${pct(debtShare)} ของสินทรัพย์`; }
      scores.push(["ความสามารถชำระหนี้", clamp(s), basis]);
    }
    {
      let s = 5;
      const why = [];
      if (!unqualified) { s -= 2; why.push("ความเห็นผู้สอบบัญชีมีเงื่อนไข"); }
      if (accused.length) { s -= 2; why.push(`คดีที่ถูกฟ้องค้าง ${accused.length} เรื่อง`); }
      else if (ongoing.length) { s -= 1; why.push(`คดี/การติดตามหนี้ค้าง ${ongoing.length} เรื่อง`); }
      if (noDisclosureSection) { s -= 1; why.push("ไม่มีหัวข้อเปิดเผยการถูกร้องทุกข์"); }
      scores.push(["ธรรมาภิบาล", clamp(s), why.length ? why.join(", ") : "ผู้สอบบัญชีไม่มีเงื่อนไข ไม่พบคดีที่ถูกฟ้อง"]);
    }
    {
      let s = 3;
      if (npG != null) s += npG > 0 ? 1 : npG < -5 && !c.profitContext ? -1 : 0;
      if (memG != null) s += memG > 0 ? 1 : memG < 0 ? -1 : 0;
      const lg = growth(loansY, (val("st_loans", "py") || 0) + (val("lt_loans", "py") || 0));
      if (lg != null && lg < 0) s -= 1;
      scores.push(["แนวโน้ม", clamp(s), `กำไร ${spct(npG)} สมาชิก ${spct(memG)} เงินให้กู้ ${spct(lg)}`]);
    }
    const total = scores.reduce((t, x) => t + x[1], 0);
    let decision = total >= 22 ? "คงวงเงิน" : total >= 18 ? "ติดตามปกติ" : total >= 14 ? "ติดตามใกล้ชิด" : total >= 10 ? "ทบทวนวงเงิน" : "ขอหลักประกัน";
    const ORDER = ["คงวงเงิน", "ติดตามปกติ", "ติดตามใกล้ชิด", "ทบทวนวงเงิน", "ขอหลักประกัน"];
    if (F.some((x) => x.sev === "risk") && ORDER.indexOf(decision) < 2) decision = "ติดตามใกล้ชิด";

    // page 2 text
    const learned = [
      `สินทรัพย์รวม ${M(val("total_assets", "y"))} (${spct(taG)}) เงินให้กู้ ${M(loansY)} เงินรับฝาก ${M(val("deposits", "y"))} ทุนของสหกรณ์ ${M(val("total_equity", "y"))}`,
      `กำไรสุทธิ ${M(np)} (${spct(npG)}) ROA ${pct(R.roa && R.roa.y)} ROE ${pct(R.roe && R.roe.y)}${h ? ` ปันผล ${pct(h.dividendRate)} เฉลี่ยคืน ${refundText(h)}` : ""}`
    ];
    if (m.total) learned.push(`สมาชิก ${cnt(m.total)} คน (${spct(memG)})${m.history && m.history.length && m.history[m.history.length - 1].joined != null ? ` เข้าใหม่ ${cnt(m.history[m.history.length - 1].joined)} คน ออก ${cnt(m.history[m.history.length - 1].left)} คน` : ""}`);
    (c.customFindings || []).forEach((x) => learned.push(x.title));
    const good = F.filter((x) => x.sev === "good").slice(0, 5).map((x) => x.title);
    const short = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + " …" : s);
    const risks = F.filter((x) => x.sev === "risk" || x.sev === "watch").slice(0, 6)
      .map((x) => `${x.sev === "risk" ? "[ความเสี่ยง]" : "[เฝ้าระวัง]"} ${x.title} — ${short(x.detail, 170)}`);
    const ADVICE = {
      "สภาพคล่อง": "ขอดูประมาณการกระแสเงินสดและแผนรองรับการถอนเงินฝาก รวมถึงวงเงินกู้สำรองที่ใช้ได้จริง",
      "ผลประกอบการ": "สอบถามสาเหตุที่กำไรเปลี่ยนแปลงและแผนรักษาระดับรายได้ดอกเบี้ย",
      "คุณภาพสินเชื่อ": "ขอรายงานลูกหนี้ค้างชำระ ลูกหนี้ตามคำพิพากษา และแผนติดตามหนี้",
      "สินเชื่อ": "ติดตามการเติบโตของสินเชื่อและคุณภาพลูกหนี้รายใหม่",
      "โครงสร้างเงินทุน": "ติดตามสัดส่วนหนี้สินต่อทุนและการพึ่งพาเงินกู้ยืม/เงินฝากจากสหกรณ์อื่น",
      "ส่วนต่างดอกเบี้ย": "ทบทวนโครงสร้างอัตราดอกเบี้ยเงินฝากและเงินกู้ให้รักษาส่วนต่างได้",
      "ความสามารถในการทำกำไร": "เปรียบเทียบ ROA/ROE กับค่าเฉลี่ยและสอบถามแผนเพิ่มประสิทธิภาพ",
      "คดีความ": "ติดตามความคืบหน้าคดีและผลกระทบทางการเงินที่อาจเกิดขึ้น",
      "คุณภาพสินทรัพย์": "ติดตามการเรียกคืนเงินฝาก/เงินลงทุนที่มีปัญหาและความเพียงพอของค่าเผื่อ",
      "ค่าใช้จ่าย": "ทบทวนค่าใช้จ่ายดำเนินงานที่เพิ่มขึ้น",
      "การกำกับดูแล": "ติดตามประเด็นธรรมาภิบาลที่ที่ประชุมใหญ่ยกขึ้น",
      "สมาชิก": "ติดตามสาเหตุการลาออกของสมาชิก",
      "เงินลงทุน": "ทบทวนความเสี่ยงของเงินลงทุนและกำไรที่ยังไม่เกิดขึ้น",
      "งบประมาณ": "ติดตามการใช้งบประมาณเทียบแผน"
    };
    const topics = [];
    F.filter((x) => x.sev === "risk" || x.sev === "watch").forEach((x) => { if (topics.indexOf(x.topic) < 0) topics.push(x.topic); });
    const advice = topics.map((t) => ADVICE[t] || `ติดตามประเด็น${t}`);
    advice.push(`ผลประเมินรวม ${total}/25 คะแนน เสนอ: ${decision}`);

    return { checks, scores, total, decision, learned, good, risks, advice };
  }

  // ------------------------------------------------------------ fill
  function fill(xml, c, a) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    // header: coop name
    const head = findParagraph(doc, (t) => t.indexOf("สหกรณ์ที่เข้าร่วม") >= 0);
    if (head) {
      const runs = directChildren(head, "r");
      const i = runs.findIndex((r) => textOf(r).indexOf("สหกรณ์ที่เข้าร่วม") >= 0);
      if (i >= 0) {
        els(runs[i], "t")[0].textContent = `สหกรณ์ที่เข้าร่วม ${c.name} `;
        // drop the underscore runs that belonged to the name blank
        for (let j = i + 1; j < runs.length && /^_+\s*$/.test(textOf(runs[j])); j++) {
          els(runs[j], "t")[0].textContent = /\s$/.test(textOf(runs[j])) ? "  " : "";
        }
      }
    }

    // checklist rows and score rows
    els(doc, "tr").forEach((tr) => {
      const cells = directChildren(tr, "tc");
      if (cells.length < 2) return;
      const label = textOf(cells[0]).trim();
      if (a.checks[label] && cells.length >= 3) {
        const [state, note] = a.checks[label];
        const box = els(cells[1], "t").find((t) => t.textContent === "☐");
        if (box) box.textContent = CHECK[state];
        const p = directChildren(cells[2], "p")[0];
        if (p) setParagraph(doc, p, note, 24);
      }
      const sc = a.scores.find((s) => s[0] === label);
      if (sc) {
        const p = directChildren(cells[1], "p")[0];
        if (p) setParagraph(doc, p, [`${sc[1]}/5`, sc[2]], 24);
      }
    });

    fillSection(doc, "สิ่งที่ได้เรียนรู้", a.learned);
    fillSection(doc, "แนวปฏิบัติที่ควรนำมาปรับใช้", a.good);
    fillSection(doc, "ประเด็นความเสี่ยง", a.risks.length ? a.risks : ["ไม่พบประเด็นความเสี่ยงหรือเฝ้าระวังจากการวิเคราะห์"]);
    fillSection(doc, "ข้อเสนอแนะต่อคณะกรรมการ", a.advice);

    // summary: tick the chosen option
    const sum = findParagraph(doc, (t) => t.indexOf("สรุป:") === 0);
    if (sum) {
      const runs = directChildren(sum, "r");
      runs.forEach((r, i) => {
        const t = els(r, "t")[0];
        if (!t || t.textContent !== "☐") return;
        const rest = runs.slice(i + 1, i + 4).map(textOf).join("");
        if (rest.trim().indexOf(a.decision) === 0) t.textContent = "☑";
      });
      // footnote after the summary
      const note = sum.cloneNode(true);
      setParagraph(doc, note, [
        `กรอกล่วงหน้าโดยอัตโนมัติจาก${c.report.title} (ปีบัญชีสิ้นสุด ${c.report.fiscalYearEnd}) ผลรวมคะแนน ${a.total}/25`,
        "☑ = ผ่านเกณฑ์  ☒ = ไม่ผ่านเกณฑ์  ☐ = ไม่มีข้อมูลในรายงาน ให้ตรวจในที่ประชุม · คะแนน 5 = แข็งแรง/ความเสี่ยงต่ำ, 1 = ความเสี่ยงสูง",
        "ผู้แทนควรตรวจทานและแก้ไขตามข้อมูลที่ได้รับในที่ประชุม"
      ], 22);
      directChildren(note, "r").forEach((r) => {
        const pr = directChildren(r, "rPr")[0];
        if (pr) directChildren(pr, "b").concat(directChildren(pr, "bCs")).forEach((b) => pr.removeChild(b));
      });
      sum.parentNode.insertBefore(note, sum.nextSibling);
    }

    return new XMLSerializer().serializeToString(doc);
  }

  function loadTemplate() {
    if (window.VISIT_TEMPLATE) return Promise.resolve(window.VISIT_TEMPLATE);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = TEMPLATE_SRC;
      s.onload = () => (window.VISIT_TEMPLATE ? resolve(window.VISIT_TEMPLATE) : reject(new Error("template missing")));
      s.onerror = () => reject(new Error("โหลดแบบฟอร์มไม่สำเร็จ"));
      document.head.appendChild(s);
    });
  }

  async function build(c, A, fmt) {
    const parts = await loadTemplate();
    const a = assess(c, A, fmt);
    const files = parts.map((p) => (p.name === "word/document.xml" ? { name: p.name, text: fill(p.text, c, a) } : p));
    return { blob: zipStore(files), assessment: a, filename: `แบบบันทึกประชุมใหญ่_${c.shortName.replace(/[\\/:*?"<>|\s]+/g, "")}_${c.report.year}.docx` };
  }

  async function download(c, A, fmt) {
    const { blob, filename } = await build(c, A, fmt);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  window.VisitForm = { build, download, assess };
})();
