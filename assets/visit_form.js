// Fill templates/visit_template.docx (สมุดบันทึกการเข้าร่วมประชุมใหญ่สหกรณ์) with one coop's analysis
// and download it. Content and layout follow the worked example for สอ.สาธารณสุขหนองบัวลำภู
// (kept outside the repo because it names the representatives): figures with prior year and benchmark in the checklist notes,
// numbered narrative points on page 2, scores with reasons, a total row and a เหตุผล paragraph.
// The template parts come from assets/visit_template.js (loaded on first use); the filled
// document is written as an uncompressed zip, so no library is needed.
(function () {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const XML_NS = "http://www.w3.org/XML/1998/namespace";
  const CHECK = { yes: "☑", no: "☒" };
  const TEMPLATE_SRC = "assets/visit_template.js?v=16";
  const OWN_COOP = "สอ.บวท.";
  const DECISIONS = ["คงวงเงิน", "ติดตามปกติ", "ติดตามใกล้ชิด", "ทบทวนวงเงิน", "ขอหลักประกัน"];
  const MONTH_ABBR = { มกราคม: "ม.ค.", กุมภาพันธ์: "ก.พ.", มีนาคม: "มี.ค.", เมษายน: "เม.ย.", พฤษภาคม: "พ.ค.", มิถุนายน: "มิ.ย.", กรกฎาคม: "ก.ค.", สิงหาคม: "ส.ค.", กันยายน: "ก.ย.", ตุลาคม: "ต.ค.", พฤศจิกายน: "พ.ย.", ธันวาคม: "ธ.ค." };

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
  const els = (node, tag) => Array.from(node.getElementsByTagNameNS(W, tag));
  const textOf = (node) => els(node, "t").map((t) => t.textContent).join("");
  const directChildren = (node, tag) => Array.from(node.childNodes).filter((n) => n.namespaceURI === W && n.localName === tag);

  // A run cloned from rPr, with optional size (half-points), bold and underline.
  function makeRun(doc, rPr, text, opt = {}) {
    const r = doc.createElementNS(W, "w:r");
    const pr = rPr ? rPr.cloneNode(true) : doc.createElementNS(W, "w:rPr");
    if (opt.size) directChildren(pr, "sz").concat(directChildren(pr, "szCs")).forEach((s) => s.setAttributeNS(W, "w:val", String(opt.size)));
    if (opt.bold === false) directChildren(pr, "b").concat(directChildren(pr, "bCs")).forEach((b) => pr.removeChild(b));
    const before = directChildren(pr, "sz")[0] || null;
    if (opt.bold && !directChildren(pr, "b").length) {
      pr.insertBefore(doc.createElementNS(W, "w:b"), before);
      pr.insertBefore(doc.createElementNS(W, "w:bCs"), before);
    }
    if (opt.underline && !directChildren(pr, "u").length) {
      const u = doc.createElementNS(W, "w:u");
      u.setAttributeNS(W, "w:val", "single");
      pr.appendChild(u);
    }
    r.appendChild(pr);
    const t = doc.createElementNS(W, "w:t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.textContent = text;
    r.appendChild(t);
    return r;
  }

  // Replace a paragraph's runs with the given segments [{text, bold, underline, size}], keeping the first run's formatting.
  function setRuns(doc, p, segments) {
    const runs = directChildren(p, "r");
    const rPr = runs[0] ? directChildren(runs[0], "rPr")[0] : null;
    runs.forEach((r) => p.removeChild(r));
    segments.forEach((s) => p.appendChild(makeRun(doc, rPr, s.text, s)));
  }

  // Hanging indent so wrapped lines of "1. ..." align under the text.
  function setHanging(doc, p, twips) {
    let pPr = directChildren(p, "pPr")[0];
    if (!pPr) { pPr = doc.createElementNS(W, "w:pPr"); p.insertBefore(pPr, p.firstChild); }
    directChildren(pPr, "ind").forEach((n) => pPr.removeChild(n));
    const ind = doc.createElementNS(W, "w:ind");
    ind.setAttributeNS(W, "w:left", String(twips));
    ind.setAttributeNS(W, "w:hanging", String(twips));
    const after = directChildren(pPr, "jc")[0] || directChildren(pPr, "rPr")[0] || null;
    pPr.insertBefore(ind, after);
  }

  // Paragraph spacing after (twips), so numbered items sit closer together than the template default.
  function setSpacingAfter(doc, p, twips) {
    let pPr = directChildren(p, "pPr")[0];
    if (!pPr) { pPr = doc.createElementNS(W, "w:pPr"); p.insertBefore(pPr, p.firstChild); }
    directChildren(pPr, "spacing").forEach((n) => pPr.removeChild(n));
    const sp = doc.createElementNS(W, "w:spacing");
    sp.setAttributeNS(W, "w:after", String(twips));
    pPr.insertBefore(sp, directChildren(pPr, "ind")[0] || directChildren(pPr, "jc")[0] || directChildren(pPr, "rPr")[0] || null);
  }

  // Bordered grid (the template's "Table Grid" style) with fixed column widths, as in the example.
  function styleTable(doc, tbl, widths) {
    const tblPr = directChildren(tbl, "tblPr")[0];
    directChildren(tblPr, "tblStyle").forEach((n) => tblPr.removeChild(n));
    const st = doc.createElementNS(W, "w:tblStyle");
    st.setAttributeNS(W, "w:val", "TableGrid");
    tblPr.insertBefore(st, tblPr.firstChild);
    const tblW = directChildren(tblPr, "tblW")[0];
    tblW.setAttributeNS(W, "w:w", String(widths.reduce((s, w) => s + w, 0)));
    tblW.setAttributeNS(W, "w:type", "dxa");
    directChildren(directChildren(tbl, "tblGrid")[0], "gridCol").forEach((g, i) => g.setAttributeNS(W, "w:w", String(widths[i])));
    directChildren(tbl, "tr").forEach((tr) => directChildren(tr, "tc").forEach((tc, i) => {
      const w = els(tc, "tcW")[0];
      if (w) { w.setAttributeNS(W, "w:w", String(widths[i])); w.setAttributeNS(W, "w:type", "dxa"); }
    }));
  }

  function findParagraph(doc, test) {
    return els(doc, "p").find((p) => test(textOf(p))) || null;
  }

  // Replace the underscore lines under a heading with numbered paragraphs.
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
    lines.forEach((line, i) => {
      const p = proto.cloneNode(true);
      setRuns(doc, p, [{ text: lines.length > 1 ? `${i + 1}. ${line}` : line, size: 28 }]);
      if (lines.length > 1) setHanging(doc, p, 284);
      setSpacingAfter(doc, p, 60);
      body.insertBefore(p, proto);
    });
    blanks.forEach((b) => body.removeChild(b));
  }

  // ------------------------------------------------------------ number formats
  const nf = (d) => new Intl.NumberFormat("th-TH", { minimumFractionDigits: d, maximumFractionDigits: d });
  const num = (v, d = 2) => (v == null || !isFinite(v) ? "–" : nf(d).format(v));
  const lb = (v) => (v == null || !isFinite(v) ? "–" : `${v < 0 ? "−" : ""}${nf(2).format(Math.abs(v) / 1e6)} ลบ.`);
  const mil = (v) => (v == null || !isFinite(v) ? "–" : `${v < 0 ? "−" : ""}${nf(2).format(Math.abs(v) / 1e6)} ล้านบาท`);
  const p1 = (v) => (v == null || !isFinite(v) ? "–" : `${nf(1).format(v)}%`);
  const p2 = (v) => (v == null || !isFinite(v) ? "–" : `${nf(2).format(v)}%`);
  const sg = (v) => (v == null || !isFinite(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf(1).format(Math.abs(v))}%`);
  const cnt = (v) => (v == null ? "–" : nf(0).format(v));
  const gr = (y, py) => (py ? ((y - py) / Math.abs(py)) * 100 : null);
  const shortDate = (s) => (s || "").replace(/(\S+)(\s+\d{4})$/, (m, mo, yr) => (MONTH_ABBR[mo] || mo) + yr);
  const clamp = (v) => Math.max(1, Math.min(5, v));
  const firstSentence = (s, n) => {
    const t = (s || "").split(/ — /)[0];
    return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + " …" : t;
  };

  // ------------------------------------------------------------ assessment
  function assess(c, A) {
    const val = (id, k) => A.val(id, k) || 0;
    const has = (id) => A.has(id);
    const R = {};
    A.ratios.forEach((r) => (R[r.id] = r));
    const rv = (id) => (R[id] && isFinite(R[id].y) ? R[id].y : null);
    const bench = (id) => (R[id] && R[id].benchmark != null ? R[id].benchmark : null);
    const F = A.findings;
    const short = c.shortName;
    const fy = shortDate(c.report.fiscalYearEnd);
    const nextYear = c.report.year + 1;

    const TA = val("total_assets", "y");
    const EQ = val("total_equity", "y");
    const np = val("net_profit", "y");
    const npp = val("net_profit", "py");
    const npG = gr(np, npp);
    const deposits = val("deposits", "y");
    const depCoop = has("dep_coop") ? val("dep_coop", "y") : 0;
    const depCoopPy = has("dep_coop") ? val("dep_coop", "py") : 0;
    const coopShare = deposits ? (depCoop / deposits) * 100 : 0;
    const borrowIds = ["st_borrow", "cur_ltb", "lt_borrow"];
    const borrow = borrowIds.reduce((s, id) => s + val(id, "y"), 0);
    const borrowPy = borrowIds.reduce((s, id) => s + val(id, "py"), 0);
    const borrowShare = TA ? (borrow / TA) * 100 : 0;
    const loansY = val("st_loans", "y") + val("lt_loans", "y");
    const loansPy = val("st_loans", "py") + val("lt_loans", "py");
    const loanG = gr(loansY, loansPy);
    const eqShare = TA ? (EQ / TA) * 100 : 0;
    const eqG = gr(EQ, val("total_equity", "py"));
    const shG = gr(val("shares", "y"), val("shares", "py"));
    const resG = gr(val("reserve", "y"), val("reserve", "py"));
    const liab = val("total_liab", "y");
    const liabG = gr(liab, val("total_liab", "py"));
    const taG = gr(TA, val("total_assets", "py"));
    const unreal = has("unrealized") ? val("unrealized", "y") : 0;
    const gain = has("inc_gain") ? val("inc_gain", "y") : 0;
    const gainPy = has("inc_gain") ? val("inc_gain", "py") : 0;
    const intExp = val("total_int_exp", "y");
    const icr = intExp > 0 ? (np + intExp) / intExp : null;
    const cr = rv("current_ratio");
    const crPy = R.current_ratio ? R.current_ratio.py : null;
    const liquidDep = rv("liquid_dep");
    const liquidCoop = rv("liquid_coopdep");
    const de = rv("de_ratio");
    const dePy = R.de_ratio ? R.de_ratio.py : null;
    const roa = rv("roa");
    const roe = rv("roe");
    const pl = rv("problem_loans");
    const yieldL = rv("loan_yield");
    const m = c.members || {};
    const memG = m.total && m.prevTotal ? gr(m.total, m.prevTotal) : null;
    const mh = m.history || [];
    const lastFlow = mh.length && mh[mh.length - 1].left != null ? mh[mh.length - 1] : null;
    const exitRecord = lastFlow && mh.length > 2 && lastFlow.left > Math.max(...mh.slice(0, -1).map((x) => x.left || 0));
    const hist = c.history || [];
    const h = hist.length ? hist[hist.length - 1] : null;
    const profitRecord = hist.length > 2 && np >= Math.max(...hist.map((x) => x.profit || 0));
    const mor = c.loanNotes && c.loanNotes.moratorium;
    const lines = (c.creditLines || []).filter((l) => l.limit);
    const unused = lines.reduce((s, l) => s + Math.max(0, l.limit - (l.balance || 0)), 0);
    const L = c.litigation || { cases: [] };
    const cases = L.cases || [];
    const ongoing = cases.filter((x) => x.status === "ongoing");
    const accused = ongoing.filter((x) => /จำเลย|ผู้ถูกกล่าวหา|ผู้ถูกร้อง/.test(x.role || ""));
    const bigOngoing = ongoing.filter((x) => !accused.includes(x) && x.amount && x.amount >= EQ * 0.01);
    const unqualified = /ไม่มีเงื่อนไข/.test(c.report.opinion || "");
    const noDisclosure = /ไม่มีหัวข้อการถูกร้องทุกข์/.test(L.disclosure || "");
    const auditorName = (c.report.auditor || "").split(" (")[0];
    const judgment = (c.loans || []).filter((l) => /คำพิพากษา/.test(l.type)).reduce((s, l) => s + (l.end || 0), 0);
    const govFindings = F.filter((f) => f.topic === "การกำกับดูแล" && (f.sev === "risk" || f.sev === "watch"))
      .concat((c.customFindings || []).filter((f) => f.topic === "การกำกับดูแล"));
    const reportIssues = F.filter((f) => f.topic === "ความถูกต้องของรายงาน").length;
    const planNext = c.plan && c.plan.next && c.plan.next.profit ? c.plan.next.profit : null;
    const planDrop = planNext ? gr(planNext, np) : null;
    const gainShare = np ? (gain / np) * 100 : 0;
    // กฎกระทรวงการฝากเงินและการลงทุน พ.ศ. 2567: ฝาก/ลงทุนต่อแห่ง ≤ 10% ของทุนเรือนหุ้นรวมทุนสำรอง (ยกเว้นชุมนุมสหกรณ์)
    const limit10 = (val("shares", "y") + val("reserve", "y")) * 0.1;
    const excess = (c.depositsPlaced || []).filter((d) => !/^ชุมนุม/.test(d.name) && d.y > limit10)
      .map((d) => ({ name: d.name.replace(/^สหกรณ์ออมทรัพย์/, "สอ.").replace(/ จำกัด.*$/, ""), y: d.y, over: d.y - limit10 }));
    const checkLabel = (ok) => (ok ? "yes" : "no");

    // ---------------- checklist: label in the template → [yes|no, note]
    const checks = {};
    checks["ได้รับรายงานประจำปี"] = ["yes", `${c.report.title} (${cnt(c.report.pages)} หน้า) พร้อมงบการเงินที่ผู้สอบบัญชีรับรองแล้ว`];
    const govChange = (c.customFindings || []).find((f) => /ผู้จัดการ|กรรมการ/.test(f.title));
    checks["กรรมการ/ผู้จัดการเปลี่ยนแปลง"] = govChange
      ? ["yes", `มี: ${govChange.title}`]
      : ["no", "งบการเงินไม่ระบุ ควรสอบถามผลเลือกตั้งกรรมการและการเปลี่ยนผู้จัดการในที่ประชุม"];
    checks["สมาชิกเพิ่ม/ลด"] = m.total
      ? [checkLabel(memG == null || memG >= 0), `${cnt(m.total)} คน${memG != null ? ` (${m.total - m.prevTotal >= 0 ? "+" : "−"}${cnt(Math.abs(m.total - m.prevTotal))}, ${sg(memG)})` : ""}${lastFlow ? ` เข้าใหม่ ${cnt(lastFlow.joined)} ออก ${cnt(lastFlow.left)} คน` : ""}${exitRecord ? ` (ออกสูงสุดในรอบ ${mh.length} ปี)` : ""}`]
      : ["no", "รายงานไม่ระบุจำนวนสมาชิก"];
    {
      let note = `${lb(np)} (${sg(npG)})${profitRecord ? " สูงสุดเป็นประวัติการณ์" : ""}`;
      if (gain > 0 && gainShare >= 10) note += ` แต่รวมกำไรขายเงินลงทุน ${lb(gain)} ไม่นับรายการนี้ ${lb(np - gain)} (${sg(gr(np - gain, npp - gainPy))})`;
      if (npG < 0 && c.profitContext) note += ` (${firstSentence(c.profitContext, 90)})`;
      checks["กำไรสุทธิ"] = [checkLabel(np > 0 && (npG == null || npG >= 0 || !!c.profitContext)), note];
    }
    {
      const ok = cr != null && (bench("current_ratio") == null || cr >= bench("current_ratio")) && coopShare < 50 && (liquidDep == null || liquidDep >= 5);
      let note = `Current ratio ${num(cr)} (ปีก่อน ${num(crPy)})`;
      if (depCoop) note += ` เงินฝากจากสหกรณ์อื่น ${lb(depCoop)} ถอนได้ทันที สินทรัพย์สภาพคล่องครอบคลุม ${p1(liquidCoop)}`;
      else note += ` สินทรัพย์สภาพคล่อง ${p1(liquidDep)} ของเงินรับฝาก`;
      checks["สภาพคล่องดี"] = [checkLabel(ok), note];
    }
    checks["ทุนเพิ่ม"] = [checkLabel(eqG > 0), `ทุน ${lb(EQ)} (${sg(eqG)}) หุ้น ${sg(shG)} ทุนสำรอง ${sg(resG)}${unreal < 0 ? ` แต่ขาดทุนที่ยังไม่เกิดขึ้น ${lb(-unreal)}` : ""}`];
    checks["หนี้ไม่เพิ่มผิดปกติ"] = [checkLabel(liabG == null || liabG <= Math.max((taG || 0) + 5, 15)),
      `หนี้สินรวม ${lb(liab)} (${sg(liabG)}) D/E ${num(de)} เท่า (ปีก่อน ${num(dePy)}, ค่าเฉลี่ย ${num(bench("de_ratio"))})`];
    {
      const parts = [];
      if (borrowPy > borrow) parts.push(`ชำระคืนเงินกู้ยืมสุทธิ ${lb(borrowPy - borrow)}${borrow ? ` คงเหลือ ${lb(borrow)}` : " จนหมด"}`);
      else if (borrow) parts.push(`เงินกู้ยืม ${lb(borrow)} (ปีก่อน ${lb(borrowPy)})`);
      if (depCoopPy > depCoop) parts.push(`คืนเงินฝากที่สหกรณ์อื่นถอน ${lb(depCoopPy - depCoop)}`);
      checks["ชำระหนี้ตรงเวลา"] = ["yes", parts.length ? `${parts.join(" และ")} ได้ตามกำหนด ไม่พบการผิดนัดในงบการเงิน` : "ไม่มีเงินกู้ยืมคงค้าง จึงไม่มีภาระชำระคืนต่อเจ้าหนี้"];
    }
    {
      let note = "ไม่พบผิดนัดต่อเจ้าหนี้/ผู้ฝาก";
      note += pl != null ? ` ลูกหนี้สมาชิกด้อยคุณภาพ ${p2(pl)}` : " งบหลักไม่แยกลูกหนี้ด้อยคุณภาพ";
      if (mor) note += ` พักชำระหนี้ ${cnt(mor.members)} ราย`;
      checks["ไม่มีผิดนัด"] = [checkLabel(pl == null || pl < 3), note];
    }
    checks["มีแผนบริหารเงินสด"] = ["no", lines.length
      ? `ไม่พบแผนในรายงาน มีวงเงิน ${lines.slice(0, 3).map((l) => `${l.lender.replace(/ธนาคาร|จำกัด|\(มหาชน\)/g, "").replace(/เพื่อการเกษตรและสหกรณ์การเกษตร/, "ธ.ก.ส.").trim()} ${num(l.limit / 1e6, 0)}${l.balance ? ` (ใช้ ${num(l.balance / 1e6, 0)})` : ""}`).join(" / ")} ลบ. ควรขอเอกสารเพิ่ม`
      : "ไม่พบแผนในรายงานและไม่ได้เปิดเผยวงเงินกู้สำรอง ควรขอเอกสารเพิ่ม"];
    checks["ผู้สอบบัญชีไม่มีเงื่อนไข"] = [checkLabel(unqualified), `${(c.report.opinion || "–").replace(/\s*\(.*\)/, "")} (${auditorName})${c.report.auditDate ? ` ลงวันที่ ${shortDate(c.report.auditDate)}` : ""}`];
    {
      let note;
      if (accused.length) note = `มีคดีที่สหกรณ์ถูกฟ้อง/ถูกกล่าวหาค้างอยู่ ${accused.length} เรื่อง: ${firstSentence(accused[0].title, 70)}`;
      else if (ongoing.length) note = `ไม่มีคดีที่สหกรณ์ถูกฟ้อง มีเพียง${firstSentence(ongoing.map((x) => x.title).join(" · "), 80)}`;
      else if (cases.length) note = `ไม่มีคดีค้าง เรื่องที่เคยมี ${cases.length} เรื่องสิ้นสุดแล้ว`;
      else note = `ไม่มีคดีฟ้องร้อง${judgment ? ` มีเพียงลูกหนี้ตามคำพิพากษา ${lb(judgment)}` : ""}`;
      checks["ไม่มีคดีสำคัญ"] = [checkLabel(!accused.length && !bigOngoing.length), note];
    }
    checks["เปิดเผยข้อมูล"] = noDisclosure
      ? ["no", `ไม่มีหัวข้อการถูกร้องทุกข์/ดำเนินคดีตามกฎกระทรวงฯ ข้อ 14(2)${reportIssues ? " และตัวเลขบางจุดในรายงานไม่ตรงกัน" : ""}`]
      : ["yes", `รายงานเรื่องร้องเรียน/คดีต่อที่ประชุมใหญ่ตามกฎกระทรวงฯ ข้อ 14(2)${reportIssues ? " แต่ตัวเลขบางจุดในรายงานไม่ตรงกัน" : ""}`];

    // ---------------- scores (5 = ดี/เสี่ยงต่ำ, 1 = เสี่ยงสูง)
    const scores = [];
    {
      let s = 3;
      const bA = bench("roa"), bE = bench("roe"), bD = bench("de_ratio");
      if (roa != null && roe != null && bA != null && bE != null) {
        if (roa >= bA && roe >= bE) s += 1;
        else if (roa < bA * 0.7 && roe < bE * 0.7) s -= 1;
      }
      if (de != null && bD != null) s += de <= bD ? 1 : de > bD * 2 ? -1 : 0;
      if (unreal < 0 && -unreal > EQ * 0.05) s -= 1;
      if (eqG != null && eqG < 0) s -= 1;
      const aboveBoth = roa >= bA && roe >= bE;
      scores.push(["ฐานะการเงิน", clamp(s), `ทุน ${p1(eqShare)} ของสินทรัพย์ ROA ${p2(roa)} ROE ${p2(roe)}${aboveBoth ? " สูงกว่าค่าเฉลี่ย" : roa >= bA ? " (ROA สูงกว่าค่าเฉลี่ย ROE ต่ำกว่า)" : roe >= bE ? " (ROE สูงกว่าค่าเฉลี่ย ROA ต่ำกว่า)" : " ต่ำกว่าค่าเฉลี่ย"} D/E ${num(de)}${unreal < 0 ? " และมีขาดทุนที่ยังไม่เกิดขึ้น" : ""}`]);
    }
    {
      const b = bench("current_ratio");
      let s = 3;
      if (cr != null && b != null) s = cr >= b ? 5 : cr >= b * 0.75 ? 4 : cr >= b * 0.5 ? 3 : cr >= b * 0.3 ? 2 : 1;
      if (coopShare > 50) s -= 2;
      else if (coopShare > 25) s -= 1;
      if (liquidDep != null && liquidDep < 5) s -= 1;
      const why = [`current ratio ${num(cr)}`];
      if (depCoop) why.push(`พึ่งเงินฝากสหกรณ์อื่น ${p1(coopShare)} ของเงินรับฝาก`);
      if (liquidDep != null && liquidDep < 5) why.push(`สินทรัพย์สภาพคล่องเพียง ${p1(liquidDep)} ของเงินรับฝาก`);
      if (unused) why.push(`มีวงเงินธนาคารคงเหลือราว ${num(unused / 1e6, 0)} ล้านบาท`);
      scores.push(["สภาพคล่อง", clamp(s), why.join(" ")]);
    }
    {
      let s = icr == null ? 5 : icr >= 5 ? 5 : icr >= 2 ? 4 : icr >= 1.5 ? 3 : icr >= 1.2 ? 2 : 1;
      if (pl != null && pl >= 3) s -= 1;
      if (borrowShare > 25) s -= 1;
      const why = [icr == null ? "ไม่มีดอกเบี้ยจ่าย" : `กำไรก่อนดอกเบี้ยจ่าย ${num(icr)} เท่าของดอกเบี้ยจ่าย`];
      if (borrowShare > 25) why.push(`เงินกู้ยืม ${p1(borrowShare)} ของสินทรัพย์`);
      why.push(pl != null && pl >= 1 ? `ลูกหนี้ด้อยคุณภาพ ${p2(pl)}` : "ไม่พบการผิดนัด");
      scores.push(["ความสามารถชำระหนี้", clamp(s), why.join(" ")]);
    }
    {
      let s = 5;
      const pos = [], neg = [];
      if (unqualified) pos.push("งบไม่มีเงื่อนไข"); else { s -= 2; neg.push("ผู้สอบบัญชีแสดงความเห็นแบบมีเงื่อนไข"); }
      if (accused.length) { s -= 2; neg.push(`มีคดีที่ถูกฟ้องค้าง ${accused.length} เรื่อง`); }
      else if (bigOngoing.length) { s -= 1; neg.push(`มีคดี/การติดตามหนี้มูลค่าสูงค้างอยู่`); }
      if (noDisclosure) { s -= 1; neg.push("ไม่มีหัวข้อเปิดเผยการถูกร้องทุกข์"); }
      if (excess.length) { s -= 1; neg.push("ฝากเงินเกินเกณฑ์กฎกระทรวง"); }
      if (govFindings.length) { s -= 1; neg.push(firstSentence(govFindings[0].title, 50)); }
      scores.push(["ธรรมาภิบาล", clamp(s), neg.length ? `${pos.length ? pos.join(" ") + " แต่" : ""}${neg.join(" ")}` : "งบไม่มีเงื่อนไข ไม่พบคดีที่ถูกฟ้อง และเปิดเผยข้อมูลครบ"]);
    }
    {
      let s = 3;
      if (npG != null) s += npG > 0 ? 1 : npG < -5 && !c.profitContext ? -1 : 0;
      // a structural event explained in the report (e.g. members splitting off) is not a trend
      if (memG != null) s += memG > 0 ? 1 : memG < 0 && !c.profitContext ? -1 : 0;
      if (loanG != null && loanG < 0 && !c.profitContext) s -= 1;
      if (planDrop != null && planDrop < -5) s -= 1;
      if (gainShare > 15) s -= 1;
      const why = [];
      if (planDrop != null && planDrop < -5) why.push(`แผนปี ${nextYear} กำไรลด ${p1(-planDrop)}`);
      if (gainShare > 15) why.push("พึ่งรายได้จากการขายเงินลงทุน");
      why.push(`กำไร ${sg(npG)} สมาชิก ${sg(memG)} เงินให้กู้ ${sg(loanG)}`);
      scores.push(["แนวโน้ม", clamp(s), why.join(" ")]);
    }
    const total = scores.reduce((t, x) => t + x[1], 0);
    let decision = total >= 22 ? "คงวงเงิน" : total >= 18 ? "ติดตามปกติ" : total >= 14 ? "ติดตามใกล้ชิด" : total >= 10 ? "ทบทวนวงเงิน" : "ขอหลักประกัน";
    if (F.some((x) => x.sev === "risk") && DECISIONS.indexOf(decision) < 2) decision = "ติดตามใกล้ชิด";
    const score = (k) => scores.find((x) => x[0] === k)[1];

    // ---------------- page 2: สิ่งที่ได้เรียนรู้
    const learned = [];
    if (coopShare > 30) {
      learned.push(`${short}ใช้เงินฝากจากสหกรณ์อื่น ${mil(depCoop)} (${p1(coopShare)} ของเงินรับฝาก) เป็นแหล่งทุนหลัก แล้วนำไปให้สมาชิกกู้ (ผลตอบแทนราว ${p1(yieldL)}) และฝาก/ลงทุนต่อ ทำให้กำไรโต แต่สภาพคล่องขึ้นกับความเชื่อมั่นของสหกรณ์ผู้ฝาก`);
    } else if (borrowShare > 15) {
      learned.push(`${short}ระดมทุนจากเงินกู้ยืม ${mil(borrow)} (${p1(borrowShare)} ของสินทรัพย์) ควบคู่กับเงินรับฝาก ${mil(deposits)} เพื่อปล่อยกู้แก่สมาชิก ${mil(loansY)} (ผลตอบแทนราว ${p1(yieldL)}) ต้นทุนและการต่ออายุเงินกู้ยืมจึงมีผลต่อกำไรและสภาพคล่องโดยตรง`);
    } else if (eqShare > 55) {
      learned.push(`${short}ใช้ทุนของตนเองเป็นแหล่งเงินหลัก (ทุนของสหกรณ์ ${p1(eqShare)} ของสินทรัพย์) แล้วนำไปให้สมาชิกกู้ ${p1((loansY / TA) * 100)} ของสินทรัพย์ (ผลตอบแทนราว ${p1(yieldL)}) ความเสี่ยงด้านแหล่งเงินทุนจึงต่ำ แต่ ROE ${p2(roe)} จะต่ำกว่าสหกรณ์ที่ใช้เงินฝากมากกว่า`);
    } else {
      learned.push(`${short}ระดมทุนจากทุนของสหกรณ์ ${p1(eqShare)} และเงินรับฝาก ${p1((deposits / TA) * 100)} ของสินทรัพย์ แล้วนำไปให้สมาชิกกู้ ${p1((loansY / TA) * 100)} ของสินทรัพย์ (ผลตอบแทนราว ${p1(yieldL)}) เป็นโครงสร้างที่พึ่งสมาชิกเป็นหลัก`);
    }
    {
      let s = `กำไรสุทธิ ${mil(np)} (${sg(npG)})${profitRecord ? " สูงสุดเป็นประวัติการณ์" : ""}`;
      if (gain > 0 && gainShare >= 10) {
        s += ` มาจากกำไรขายเงินลงทุน ${mil(gain)} ถ้าไม่นับรายการนี้กำไร${gr(np - gain, npp - gainPy) >= 0 ? "เพิ่ม" : "ลด"}เพียง ${p1(Math.abs(gr(np - gain, npp - gainPy)))}`;
        if (unreal < 0) s += ` และยังมีขาดทุนที่ยังไม่เกิดขึ้น ${mil(-unreal)} ในส่วนทุน จึงต้องอ่านงบกำไรขาดทุนคู่กับส่วนของทุนเสมอ`;
      } else {
        const sp = R.spread;
        s += ` รายได้หลักคือดอกเบี้ยเงินให้กู้ ${p1((val("inc_loan", "y") / val("total_int_income", "y")) * 100)} ของรายได้ดอกเบี้ย${sp && isFinite(sp.y) ? ` ส่วนต่างดอกเบี้ย ${num(sp.y)} จุด (ปีก่อน ${num(sp.py)})` : ""}`;
        if (c.profitContext && npG < 0) s += ` — ${firstSentence(c.profitContext, 160)}`;
      }
      learned.push(s);
    }
    if (pl != null) {
      learned.push(`คุณภาพสินเชื่อ${pl < 1 ? "ดีมาก" : pl < 3 ? "อยู่ในเกณฑ์ที่ต้องติดตาม" : "น่ากังวล"} (หนี้ด้อยคุณภาพ ${p2(pl)})${pl < 1 ? " เพราะหักชำระหนี้ผ่านเงินเดือนสมาชิก" : ""}${mor ? ` และมีมาตรการพักชำระหนี้ช่วยสมาชิก ${cnt(mor.members)} ราย` : ""}`);
    } else {
      learned.push(`งบหลักไม่แยกลูกหนี้ด้อยคุณภาพ แต่ผู้สอบบัญชีแสดงความเห็น${unqualified ? "แบบไม่มีเงื่อนไข" : "แบบมีเงื่อนไข"} ควรขอรายงานอายุลูกหนี้ประกอบการพิจารณา`);
    }
    if (excess.length || (c.depositsPlaced || []).length) {
      learned.push(`กฎกระทรวงการฝากเงินและการลงทุน พ.ศ. 2567 จำกัดการฝาก/ลงทุนต่อแห่งไม่เกิน 10% ของทุนเรือนหุ้นรวมทุนสำรอง (ของสหกรณ์นี้ราว ${mil(limit10)}; ยกเว้นชุมนุมสหกรณ์ที่เป็นสมาชิกและหลักทรัพย์รัฐบาล) ส่วนที่เกินต้องแก้ไขภายใน 5 ปี`);
    } else if (h) {
      learned.push(`คืนกำไรให้สมาชิกเป็นปันผล ${p2(h.dividendRate)} และเฉลี่ยคืน ${h.refundRateText || p2(h.refundRate)} รวม ${p1(((h.dividend + h.refund) / h.profit) * 100)} ของกำไรสุทธิ`);
    }
    (c.customFindings || []).filter((f) => f.sev === "info" && f.topic !== "การกำกับดูแล").forEach((f) => learned.push(firstSentence(f.detail, 220)));

    // ---------------- แนวปฏิบัติที่ควรนำมาปรับใช้
    const practices = [];
    if (!noDisclosure && (cases.length || /ร้องเรียน/.test(L.disclosure || ""))) practices.push("รายงานข้อร้องเรียน/คดีความพร้อมแนวทางป้องกันต่อที่ประชุมใหญ่ตามกฎกระทรวงฯ ข้อ 14(2) อย่างเป็นรูปธรรม");
    if (cases.some((x) => /ไกล่เกลี่ย/.test(x.type || x.title))) practices.push("ใช้การไกล่เกลี่ยก่อนฟ้องและสืบทรัพย์ลูกหนี้ตามคำพิพากษาเป็นรอบ ลดต้นทุนและระยะเวลาการดำเนินคดี");
    if (c.reportedRatios) practices.push("แสดงอัตราส่วนทางการเงินเทียบค่าเฉลี่ยสหกรณ์ออมทรัพย์ทั่วประเทศในรายงานประจำปี ให้สมาชิกเห็นภาพชัด");
    if (c.plan || c.budget) practices.push("แสดงตารางประมาณการเทียบผลจริงและแผนปีถัดไปในรายงานประจำปี");
    if (pl != null && pl < 1) practices.push(`หักชำระหนี้ผ่านเงินเดือนและติดตามลูกหนี้ต่อเนื่อง ทำให้หนี้ด้อยคุณภาพเพียง ${p2(pl)}`);
    if (lines.length >= 2) practices.push("เปิดวงเงินกู้สำรองกับหลายสถาบันการเงินไว้รองรับสภาพคล่อง");
    if (h && h.reserve && h.reserve / h.profit > 0.105) practices.push(`จัดสรรกำไรเข้าทุนสำรองเกินขั้นต่ำ (${p1((h.reserve / h.profit) * 100)} ของกำไร) เพิ่มความมั่นคงของทุน`);
    if (eqShare > 55) practices.push(`สะสมทุนของตนเองสูง (${p1(eqShare)} ของสินทรัพย์) ลดการพึ่งพาเงินกู้ยืมและเงินฝากจากภายนอก`);
    const opexA = rv("opex_assets");
    if (opexA != null && opexA < 0.5) practices.push(`ควบคุมค่าใช้จ่ายดำเนินงานได้ต่ำ (${p2(opexA)} ของสินทรัพย์)`);
    if (gain > 0 && gainShare >= 10) practices.push("แยกแสดงกำไรจากธุรกิจหลักกับกำไรจากการขายเงินลงทุนให้ชัด เมื่อนำเสนอผลการดำเนินงานต่อสมาชิก");
    practices.splice(4);
    if (!practices.length) practices.push("ไม่พบแนวปฏิบัติเด่นจากรายงาน");

    // ---------------- ประเด็นความเสี่ยง
    const risks = [];
    if (coopShare > 30) risks.push(`แหล่งเงินทุนกระจุกตัว: เงินฝากจากสหกรณ์อื่น ${mil(depCoop)} ถอนได้ทันที current ratio ${num(cr)} สินทรัพย์สภาพคล่องครอบคลุมเพียง ${p1(liquidCoop)}${unused ? ` (มีวงเงินธนาคารคงเหลือราว ${num(unused / 1e6, 0)} ล้านบาทเป็นกันชน)` : ""}`);
    if (unreal < 0 && -unreal > EQ * 0.005) risks.push(`ความเสี่ยงตลาด: ขาดทุนที่ยังไม่เกิดขึ้น ${mil(-unreal)} (${p1((-unreal / EQ) * 100)} ของทุน)`);
    excess.forEach((d) => risks.push(`เงินฝาก ${d.name} ${mil(d.y)} เกินเกณฑ์ 10% (ส่วนเกินราว ${mil(d.over)}) ต้องแก้ไขภายใน 5 ปี`));
    // topics already told by the items above, so the matching findings are not repeated
    const covered = new Set();
    if (coopShare > 30) covered.add("สภาพคล่อง").add("แหล่งเงินทุน");
    if (unreal < 0 && -unreal > EQ * 0.005) covered.add("เงินลงทุน");
    if (mor || exitRecord) covered.add("สมาชิก");
    const fromFindings = (sev) => F.filter((f) => f.sev === sev && !covered.has(f.topic)).map((f) => {
      covered.add(f.topic);
      return `${f.topic}: ${f.title}${f.detail && f.detail.indexOf(f.title) < 0 ? ` — ${firstSentence(f.detail, 110)}` : ""}`;
    });
    risks.push(...fromFindings("risk"));
    if (planDrop != null && planDrop < -5) risks.push(`แนวโน้มกำไร: แผนปี ${nextYear} คาดกำไรลด ${p1(-planDrop)} เหลือ ${mil(planNext)}`);
    if (govFindings.length) risks.push(`ธรรมาภิบาล: ${govFindings[0].title}`);
    if (mor || exitRecord) risks.push(`สัญญาณสินเชื่อและสมาชิก:${mor ? ` พักชำระหนี้ ${cnt(mor.members)} ราย ${cnt(mor.contracts)} สัญญา (${mil(mor.amount)})` : ""}${exitRecord ? ` สมาชิกออก ${cnt(lastFlow.left)} คน สูงสุดในรอบ ${mh.length} ปี` : ""}`);
    risks.push(...fromFindings("watch"));
    risks.splice(6);
    if (!risks.length) risks.push("ไม่พบประเด็นความเสี่ยงหรือเฝ้าระวังจากการวิเคราะห์งบการเงิน");

    // ---------------- ข้อเสนอแนะต่อคณะกรรมการ
    const advice = [];
    const ACTION = {
      "คงวงเงิน": `คงวงเงินที่มีกับ ${short} ตามเดิม จัดอยู่ในกลุ่ม "คงวงเงิน" และทบทวนปีละครั้งหลังประชุมใหญ่`,
      "ติดตามปกติ": `คงวงเงินที่มีกับ ${short} ไว้ จัดอยู่ในกลุ่ม "ติดตามปกติ" และทบทวนทุกครึ่งปี`,
      "ติดตามใกล้ชิด": `คงวงเงินที่มีกับ ${short} ไว้ ไม่เพิ่มวงเงินในระยะนี้ จัดอยู่ในกลุ่ม "ติดตามใกล้ชิด" และทบทวนทุกไตรมาส`,
      "ทบทวนวงเงิน": `ทบทวนลดวงเงินที่มีกับ ${short} ไม่ต่ออายุส่วนที่ครบกำหนดจนกว่าประเด็นความเสี่ยงจะคลี่คลาย และติดตามรายเดือน`,
      "ขอหลักประกัน": `ขอหลักประกันเพิ่มก่อนให้วงเงินใหม่หรือต่ออายุวงเงินเดิมกับ ${short} และติดตามรายเดือน`
    };
    advice.push(ACTION[decision]);
    {
      const docs = [];
      if (DECISIONS.indexOf(decision) >= 2) docs.push("งบการเงินรายไตรมาส");
      if (depCoop) docs.push("สัดส่วนสหกรณ์ผู้ฝากรายใหญ่");
      docs.push("แผนบริหารสภาพคล่องและตารางครบกำหนด");
      if (pl == null) docs.push("รายงานอายุลูกหนี้และลูกหนี้ค้างชำระ");
      if (borrow) docs.push("รายละเอียดวงเงินกู้ยืมและกำหนดชำระคืน");
      if (unreal < 0 || gain) docs.push("นโยบายการลงทุนและการตัดขาดทุน");
      (c.customFindings || []).filter((f) => f.topic === "คุณภาพสินทรัพย์").forEach((f) => docs.push(`ความคืบหน้าเรื่อง${firstSentence(f.title, 120)}`));
      advice.push(`ขอเอกสารเพิ่ม: ${docs.join(" ")}`);
    }
    if (decision !== "ขอหลักประกัน") {
      const next = DECISIONS[Math.max(DECISIONS.indexOf(decision) + 1, 2)];
      const trig = [];
      if (depCoop) trig.push("เงินฝากจากสหกรณ์อื่นลดลงเกิน 20% ในไตรมาสเดียว", "สินทรัพย์สภาพคล่องต่ำกว่า 50% ของเงินฝากจากสหกรณ์อื่น");
      else if (cr != null) trig.push(`current ratio ต่ำกว่า ${num(cr * 0.75)}`);
      if (borrowShare > 15) trig.push("ต่ออายุวงเงินกู้ยืมไม่ได้หรือต้นทุนเงินกู้เพิ่มเกิน 1 จุด");
      if (unreal < 0) trig.push("ขาดทุนที่ยังไม่เกิดขึ้นเกิน 5% ของทุน");
      trig.push(`หนี้ด้อยคุณภาพเกิน ${p1(Math.max(1, (pl || 0) * 2))} ของเงินให้กู้`);
      excess.forEach((d) => trig.push(`ไม่คืนเงินฝาก ${d.name} ตามแผน`));
      if (accused.length || bigOngoing.length) trig.push("คดีที่ค้างมีคำพิพากษาให้สหกรณ์เสียหายเป็นเงินมาก");
      advice.push(`เกณฑ์ยกระดับเป็น "${next === decision ? "ทบทวนวงเงิน" : next}": ${trig.join(" ")}`);
    }
    advice.push(`ตรวจสอบว่ายอดฝาก/ให้กู้ของ ${OWN_COOP} กับสหกรณ์นี้ไม่เกิน 10% ของทุนเรือนหุ้นรวมทุนสำรองของ ${OWN_COOP} ตามกฎกระทรวง พ.ศ. 2567`);
    advice.push(`ติดตามมติที่ประชุมใหญ่ ผลเลือกตั้งกรรมการ และแผนการดำเนินงานปี ${nextYear}${ongoing.length ? " รวมถึงความคืบหน้าคดีที่ค้างอยู่" : ""}`);

    // ---------------- เหตุผล
    const strong = [];
    if (score("ฐานะการเงิน") >= 4) strong.push("ทุนและกำไรแข็งแรง");
    if (pl != null && pl < 1) strong.push("หนี้ด้อยคุณภาพต่ำ");
    if (score("สภาพคล่อง") >= 4) strong.push("สภาพคล่องเพียงพอ");
    if (!accused.length && !bigOngoing.length) strong.push("ไม่มีคดีสำคัญ");
    const weak = [];
    if (coopShare > 30) weak.push("พึ่งพาเงินฝากจากสหกรณ์อื่นที่ถอนได้ทันที");
    else if (score("สภาพคล่อง") <= 2) weak.push("สภาพคล่องต่ำ");
    if (borrowShare > 15) weak.push("พึ่งพาเงินกู้ยืม");
    if (unreal < 0 && -unreal > EQ * 0.005) weak.push("มีขาดทุนจากเงินลงทุน");
    if (excess.length) weak.push("มีเงินฝากเกินเกณฑ์กฎกระทรวง");
    if (npG != null && npG < -5 && !c.profitContext) weak.push("กำไรลดลง");
    if (accused.length || bigOngoing.length) weak.push("มีคดี/หนี้ที่ต้องติดตาม");
    (c.customFindings || []).filter((f) => f.sev === "watch" && f.topic !== "การกำกับดูแล").slice(0, 1).forEach((f) => weak.push(firstSentence(f.title, 120)));
    const DO = {
      "คงวงเงิน": "จึงเสนอให้คงวงเงินเดิมและติดตามตามรอบปกติ",
      "ติดตามปกติ": "จึงเสนอให้คงวงเงินเดิมและติดตามทุกครึ่งปี",
      "ติดตามใกล้ชิด": "จึงเสนอให้คงวงเงินเดิม ไม่เพิ่มวงเงิน และติดตามรายไตรมาส",
      "ทบทวนวงเงิน": "จึงเสนอให้ทบทวนลดวงเงินและติดตามรายเดือน",
      "ขอหลักประกัน": "จึงเสนอให้ขอหลักประกันเพิ่มก่อนให้วงเงิน"
    };
    const reason = `${strong.length ? strong.join(" ") : "ผลการดำเนินงานอยู่ในเกณฑ์"}${weak.length ? ` แต่${weak.join(" ")}` : ""} ${DO[decision]}`;

    return { checks, scores, total, decision, learned, practices, risks, advice, reason, fy };
  }

  // ------------------------------------------------------------ fill
  function fill(xml, c, a) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const body = els(doc, "body")[0];

    // header: coop name underlined; date and representatives stay blank for the visitor
    const head = findParagraph(doc, (t) => t.indexOf("สหกรณ์ที่เข้าร่วม") >= 0);
    if (head) {
      const runs = directChildren(head, "r");
      const i = runs.findIndex((r) => textOf(r).indexOf("สหกรณ์ที่เข้าร่วม") >= 0);
      if (i >= 0) {
        const rPr = directChildren(runs[i], "rPr")[0];
        els(runs[i], "t")[0].textContent = "สหกรณ์ที่เข้าร่วม ";
        head.insertBefore(makeRun(doc, rPr, c.name, { underline: true }), runs[i].nextSibling);
        for (let j = i + 1; j < runs.length && /^_+\s*$/.test(textOf(runs[j])); j++) {
          els(runs[j], "t")[0].textContent = /\s$/.test(textOf(runs[j])) ? "   " : "";
        }
        if (a.date) {
          const all = directChildren(head, "r");
          const d = all.findIndex((r) => textOf(r).indexOf("วันที่") >= 0);
          if (d >= 0) {
            els(all[d], "t")[0].textContent = "วันที่ ";
            head.insertBefore(makeRun(doc, directChildren(all[d], "rPr")[0], a.date, { underline: true }), all[d].nextSibling);
            head.insertBefore(makeRun(doc, directChildren(all[d], "rPr")[0], " "), all[d].nextSibling);
            for (let j = d + 1; j < all.length && /^_+\s*$/.test(textOf(all[j])); j++) els(all[j], "t")[0].textContent = "";
          }
        }
      }
    }

    // a plain body paragraph to clone for inserted text
    const protoBlank = els(doc, "p").find((p) => /^_+$/.test(textOf(p).trim()));
    const plainPara = (segments, size) => {
      const p = protoBlank.cloneNode(true);
      setRuns(doc, p, segments.map((s) => Object.assign({ size }, s)));
      return p;
    };

    // checklist rows and score rows
    const tables = els(doc, "tbl");
    els(doc, "tr").forEach((tr) => {
      const cells = directChildren(tr, "tc");
      if (cells.length < 2) return;
      const label = textOf(cells[0]).trim();
      if (a.checks[label] && cells.length >= 3) {
        const [state, note] = a.checks[label];
        const box = els(cells[1], "t").find((t) => t.textContent === "☐");
        if (box) box.textContent = CHECK[state];
        const p = directChildren(cells[2], "p")[0];
        if (p) setRuns(doc, p, [{ text: note, size: 24 }]);
      }
      if (label === "หัวข้อ" && textOf(cells[1]).trim() === "คะแนน") {
        const p = directChildren(cells[1], "p")[0];
        const t = els(p, "t");
        t[t.length - 1].textContent = "คะแนน / เหตุผล";
      }
      const sc = a.scores.find((s) => s[0] === label);
      if (sc) {
        const p = directChildren(cells[1], "p")[0];
        if (p) setRuns(doc, p, [{ text: `${sc[1]}/5  `, bold: true, size: 28 }, { text: sc[2], size: 24 }]);
      }
    });

    // score table: total row cloned from the last score row
    const scoreTable = tables.find((t) => textOf(t).indexOf("แนวโน้ม") >= 0);
    if (scoreTable) {
      const rows = directChildren(scoreTable, "tr");
      const last = rows[rows.length - 1];
      const totalRow = last.cloneNode(true);
      const cells = directChildren(totalRow, "tc");
      setRuns(doc, directChildren(cells[0], "p")[0], [{ text: "รวม", bold: true }]);
      setRuns(doc, directChildren(cells[1], "p")[0], [{ text: `${a.total}/25  `, bold: true, size: 28 }, { text: "(5 = ดี/เสี่ยงต่ำ, 1 = เสี่ยงสูง)", size: 24 }]);
      scoreTable.appendChild(totalRow);
    }

    // page text width is 10206 twips (12240 minus the template's margins)
    if (scoreTable) styleTable(doc, scoreTable, [2400, 7806]);
    const checkTable = tables.find((t) => textOf(t).indexOf("ได้รับรายงานประจำปี") >= 0);
    if (checkTable) styleTable(doc, checkTable, [2900, 700, 6606]);

    // legend under the checklist table
    if (checkTable && protoBlank) {
      body.insertBefore(plainPara([{ text: `${CHECK.yes} = ใช่ / เป็นไปตามรายการ   ${CHECK.no} = ไม่ใช่ / ต้องติดตาม   ลบ. = ล้านบาท   ข้อมูล ณ ${a.fy}` }], 22), checkTable.nextSibling);
    }

    fillSection(doc, "สิ่งที่ได้เรียนรู้", a.learned);
    fillSection(doc, "แนวปฏิบัติที่ควรนำมาปรับใช้", a.practices);
    fillSection(doc, "ประเด็นความเสี่ยง", a.risks);
    fillSection(doc, "ข้อเสนอแนะต่อคณะกรรมการ", a.advice);

    // summary: tick the chosen option, then the reason
    const sum = findParagraph(doc, (t) => t.indexOf("สรุป:") === 0);
    if (sum) {
      const runs = directChildren(sum, "r");
      runs.forEach((r, i) => {
        const t = els(r, "t")[0];
        if (!t || t.textContent !== "☐") return;
        const rest = runs.slice(i + 1, i + 4).map(textOf).join("");
        if (rest.trim().indexOf(a.decision) === 0) t.textContent = "☑";
      });
      const why = sum.cloneNode(true);
      setRuns(doc, why, [{ text: "เหตุผล: ", bold: true, size: 28 }, { text: a.reason, bold: false, size: 28 }]);
      sum.parentNode.insertBefore(why, sum.nextSibling);
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

  // overrides: optional hand-written content (any field returned by assess, plus date) that replaces the generated one
  async function build(c, A, overrides) {
    const parts = await loadTemplate();
    const a = Object.assign(assess(c, A), overrides || {});
    const files = parts.map((p) => (p.name === "word/document.xml" ? { name: p.name, text: fill(p.text, c, a) } : p));
    return { blob: zipStore(files), assessment: a, filename: `แบบบันทึกประชุมใหญ่_${c.shortName.replace(/[\\/:*?"<>|\s]+/g, "")}_${c.report.year}.docx` };
  }

  async function download(c, A) {
    const { blob, filename } = await build(c, A);
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
