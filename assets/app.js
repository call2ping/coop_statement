// Annual-report analysis app. Reads window.COOP_DATA (see data/*.js), derives
// changes, ratios and rule-based findings, and renders filterable views.
(function () {
  "use strict";

  const C = window.Charts;
  const esc = C.esc;
  const coops = window.COOP_DATA || [];
  coops.forEach((c) => { if (!c.litigation && window.COOP_LITIGATION && window.COOP_LITIGATION[c.id]) c.litigation = window.COOP_LITIGATION[c.id]; });
  const BENCH = window.COOP_BENCHMARKS || {};

  // ------------------------------------------------------------ formatting
  const nf2 = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
  const baht = (v) => (v == null ? "–" : v < 0 ? `(${nf2.format(-v)})` : nf2.format(v));
  const mb = (v) => (v == null ? "–" : (v < 0 ? "−" : "") + nf2.format(Math.abs(v) / 1e6));
  const M = (v) => `${mb(v)} ล้านบาท`;
  const amt = (v) => (Math.abs(v) >= 1e6 ? M(v) : `${v < 0 ? "−" : ""}${nf0.format(Math.abs(v))} บาท`);
  const pct = (v) => (v == null || !isFinite(v) ? "–" : nf2.format(v) + "%");
  const spct = (v) => (v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf2.format(Math.abs(v)) + "%");
  const cnt = (v) => (v == null ? "–" : nf0.format(v));
  const refundText = (h) => (h ? h.refundRateText || pct(h.refundRate) : "–");
  const growth = (y, py) => (py ? ((y - py) / Math.abs(py)) * 100 : null);
  const sum = (arr) => arr.reduce((s, x) => s + (x || 0), 0);

  function fmtUnit(v, unit) {
    if (v == null || !isFinite(v)) return "–";
    if (unit === "x") return nf2.format(v) + " เท่า";
    if (unit === "pt") return nf2.format(v) + " จุด";
    if (unit === "baht") return nf0.format(v) + " บาท";
    return pct(v);
  }

  // ------------------------------------------------------------ state
  const TABS = [
    { id: "overview", label: "ภาพรวม" },
    { id: "statements", label: "งบการเงิน" },
    { id: "ratios", label: "อัตราส่วนทางการเงิน" },
    { id: "portfolio", label: "สินเชื่อ เงินฝาก และแหล่งเงินทุน" },
    { id: "budget", label: "งบประมาณ" },
    { id: "trends", label: "แนวโน้มหลายปี" },
    { id: "legal", label: "คดีความและการร้องเรียน" },
    { id: "findings", label: "ข้อค้นพบ" }
  ];
  const SEV = {
    risk: { label: "ความเสี่ยง", icon: "!", rank: 0 },
    watch: { label: "เฝ้าระวัง", icon: "!", rank: 1 },
    good: { label: "จุดแข็ง", icon: "✓", rank: 2 },
    info: { label: "ข้อสังเกต", icon: "i", rank: 3 }
  };
  const ST_LABEL = { bs: "งบฐานะการเงิน", is: "งบกำไรขาดทุน", cf: "งบกระแสเงินสด" };
  const WEAK_CONTROL = ["พอใช้", "ต้องปรับปรุง", "ต้องปรับปรุงเร่งด่วน"];

  const state = {
    view: "home",
    coop: 0,
    tab: "overview",
    home: { q: "", year: "all", sort: "assets", riskOnly: false, issuesOnly: false, cat: "all", benchOnly: false },
    st: { statement: "all", sec: "all", level: "main", dir: "all", minPct: 0, q: "", sort: "order", sortDir: -1 },
    ratio: { cat: "all", trend: "all", bench: "all" },
    port: { sections: new Set(["loans", "funding", "placed", "invest", "lines"]), q: "", problemOnly: false },
    budget: { cat: "all", status: "all", q: "", sort: "variance" },
    trend: { from: null, to: null },
    legal: { status: "all", role: "all", q: "" },
    find: { sev: new Set(["risk", "watch", "good", "info"]), topic: "all", q: "" }
  };

  // ------------------------------------------------------------ analysis
  const BORROW_IDS = ["st_borrow", "cur_ltb", "lt_borrow"];
  const MEMBER_DEP_IDS = ["dep_m_sav", "dep_m_special", "dep_m_fixed"];

  function analyze(c) {
    const byId = {};
    c.items.forEach((i) => (byId[i.id] = i));
    const has = (id) => !!byId[id];
    const val = (id, k) => (byId[id] ? byId[id][k] : null);
    const sumIds = (ids, k) => sum(ids.map((id) => val(id, k)));
    const revenue = (k) => val("total_int_income", k) + val("total_other_income", k);
    const items = c.items.map((i, idx) => {
      const change = i.y - i.py;
      let base = null;
      if (i.st === "bs") base = val("total_assets", "y");
      else if (i.st === "is") base = revenue("y");
      return Object.assign({}, i, {
        order: idx,
        change,
        pct: i.py !== 0 ? (change / Math.abs(i.py)) * 100 : null,
        share: base ? (i.y / base) * 100 : null,
        isNew: i.py === 0 && i.y !== 0
      });
    });
    const A = { val, has, sumIds, items, revenue };
    A.ratios = computeRatios(c, A);
    A.findings = computeFindings(c, A);
    return A;
  }

  const RATIO_CATS = ["สภาพคล่อง", "โครงสร้างเงินทุน", "ความสามารถในการทำกำไร", "ส่วนต่างและประสิทธิภาพ", "คุณภาพสินทรัพย์", "ต่อสมาชิก"];

  function problemLoans(c, k) {
    const na = c.loanNotes && c.loanNotes.nonAccrual ? c.loanNotes.nonAccrual[k] : undefined;
    if (!c.loans && na === undefined) return null;
    if (na === null) return null;
    const rows = c.loans ? sum(c.loans.filter((l) => l.problem).map((l) => (k === "y" ? l.end : l.begin))) : 0;
    return rows + (na || 0);
  }

  function computeRatios(c, A) {
    const { val, has, sumIds } = A;
    const rr = c.reportedRatios || {};
    const bench = (BENCH[c.type] && BENCH[c.type].ratios) || {};
    const prior = c.priorBalances || {};
    const loans = (k) => val("st_loans", k) + val("lt_loans", k);
    const liquid = (k) => val("cash", k) + val("dep_coops", k) + val("st_invest", k);
    const loanInt = (k) => val("inc_loan", k) + val("inc_exmember", k) + val("inc_judgment", k) + val("inc_nonaccrual", k);
    const rev = (k) => val("total_int_income", k) + val("total_other_income", k);
    const borrow = (k) => sumIds(BORROW_IDS, k);
    const fundingBase = (k) => val("deposits", k) + borrow(k);
    const m = c.members || {};
    const members = (k) => (k === "y" ? m.total : m.prevTotal);
    const yieldF = (k) => (loanInt(k) / loans(k)) * 100;
    const costF = (k) => (val("total_int_exp", k) / fundingBase(k)) * 100;
    // Average-balance ratios: the current year uses (opening + closing) / 2; the prior year
    // uses closing balances unless priorBalances supplies the opening figure.
    const avgRatio = (num, bal) => (k) => {
      if (k === "y") return (val(num, "y") / ((val(bal, "y") + val(bal, "py")) / 2)) * 100;
      const open = prior[bal];
      return (val(num, "py") / (open != null ? (val(bal, "py") + open) / 2 : val(bal, "py"))) * 100;
    };
    const pyApproxAvg = prior.total_assets == null;

    const defs = [
      { id: "current_ratio", cat: "สภาพคล่อง", label: "อัตราส่วนทุนหมุนเวียน (Current ratio)", unit: "x", better: "higher", f: (k) => val("total_ca", k) / val("total_cl", k), formula: "สินทรัพย์หมุนเวียน ÷ หนี้สินหมุนเวียน" },
      { id: "liquid_dep", cat: "สภาพคล่อง", label: "สินทรัพย์สภาพคล่องต่อเงินรับฝาก", unit: "%", better: "higher", f: (k) => (liquid(k) / val("deposits", k)) * 100, formula: "(เงินสด + เงินฝากธนาคาร + เงินฝากสหกรณ์อื่น + เงินลงทุนระยะสั้น) ÷ เงินรับฝาก" },
      { id: "liquid_coopdep", cat: "สภาพคล่อง", label: "สินทรัพย์สภาพคล่องต่อเงินรับฝากจากสหกรณ์อื่น", unit: "%", better: "higher", needs: ["dep_coop"], f: (k) => (liquid(k) / val("dep_coop", k)) * 100, formula: "สินทรัพย์สภาพคล่อง ÷ เงินรับฝากจากสหกรณ์อื่น" },
      { id: "de_ratio", cat: "โครงสร้างเงินทุน", label: "หนี้สินต่อทุน (D/E)", unit: "x", better: "lower", f: (k) => val("total_liab", k) / val("total_equity", k), formula: "หนี้สินทั้งสิ้น ÷ ทุนของสหกรณ์" },
      { id: "equity_assets", cat: "โครงสร้างเงินทุน", label: "ทุนของสหกรณ์ต่อสินทรัพย์", unit: "%", better: "higher", f: (k) => (val("total_equity", k) / val("total_assets", k)) * 100, formula: "ทุนของสหกรณ์ ÷ สินทรัพย์รวม" },
      { id: "reserve_assets", cat: "โครงสร้างเงินทุน", label: "ทุนสำรองต่อสินทรัพย์", unit: "%", better: "higher", f: (k) => (val("reserve", k) / val("total_assets", k)) * 100, formula: "ทุนสำรอง ÷ สินทรัพย์รวม" },
      { id: "coopdep_share", cat: "โครงสร้างเงินทุน", label: "สัดส่วนเงินรับฝากจากสหกรณ์อื่น", unit: "%", better: "lower", needs: ["dep_coop"], f: (k) => (val("dep_coop", k) / val("deposits", k)) * 100, formula: "เงินรับฝากจากสหกรณ์อื่น ÷ เงินรับฝากทั้งหมด" },
      { id: "ext_funding", cat: "โครงสร้างเงินทุน", label: "แหล่งเงินทุนจากภายนอกต่อสินทรัพย์", unit: "%", better: "lower", f: (k) => ((val("dep_coop", k) + borrow(k)) / val("total_assets", k)) * 100, formula: "(เงินรับฝากจากสหกรณ์อื่น + เงินกู้ยืม) ÷ สินทรัพย์รวม" },
      { id: "roa", cat: "ความสามารถในการทำกำไร", label: "ผลตอบแทนต่อสินทรัพย์ (ROA)", unit: "%", better: "higher", f: avgRatio("net_profit", "total_assets"), pyApprox: pyApproxAvg, formula: "กำไรสุทธิ ÷ สินทรัพย์ถัวเฉลี่ย (ต้นปี + สิ้นปี) ÷ 2" },
      { id: "roe", cat: "ความสามารถในการทำกำไร", label: "ผลตอบแทนต่อทุน (ROE)", unit: "%", better: "higher", f: avgRatio("net_profit", "total_equity"), pyApprox: pyApproxAvg, formula: "กำไรสุทธิ ÷ ทุนของสหกรณ์ถัวเฉลี่ย (ต้นปี + สิ้นปี) ÷ 2" },
      { id: "npm", cat: "ความสามารถในการทำกำไร", label: "อัตรากำไรสุทธิ (NPM)", unit: "%", better: "higher", f: (k) => (val("net_profit", k) / val("total_int_income", k)) * 100, formula: "กำไรสุทธิ ÷ รายได้ดอกเบี้ยและผลตอบแทนจากเงินลงทุน" },
      { id: "gain_share", cat: "ความสามารถในการทำกำไร", label: "กำไรจากการขายเงินลงทุนต่อกำไรสุทธิ", unit: "%", better: "lower", needs: ["inc_gain"], f: (k) => (val("inc_gain", k) / val("net_profit", k)) * 100, formula: "กำไรจากการจำหน่ายเงินลงทุน ÷ กำไรสุทธิ" },
      { id: "loan_yield", cat: "ส่วนต่างและประสิทธิภาพ", label: "ผลตอบแทนเงินให้กู้ (ประมาณ)", unit: "%", better: "higher", f: yieldF, formula: "ดอกเบี้ยรับจากเงินให้กู้ ÷ เงินให้กู้ ณ สิ้นปี" },
      { id: "cost_dep", cat: "ส่วนต่างและประสิทธิภาพ", label: "ต้นทุนเงินรับฝาก (ประมาณ)", unit: "%", better: "lower", f: (k) => (val("ie_deposit", k) / val("deposits", k)) * 100, formula: "ดอกเบี้ยจ่ายเงินรับฝาก ÷ เงินรับฝาก ณ สิ้นปี" },
      { id: "cost_funds", cat: "ส่วนต่างและประสิทธิภาพ", label: "ต้นทุนเงินทุน (ประมาณ)", unit: "%", better: "lower", f: costF, formula: "ดอกเบี้ยจ่ายทั้งหมด ÷ (เงินรับฝาก + เงินกู้ยืม) ณ สิ้นปี" },
      { id: "spread", cat: "ส่วนต่างและประสิทธิภาพ", label: "ส่วนต่างอัตราดอกเบี้ย (Spread)", unit: "pt", better: "higher", f: (k) => yieldF(k) - costF(k), formula: "ผลตอบแทนเงินให้กู้ − ต้นทุนเงินทุน" },
      { id: "opex_rev", cat: "ส่วนต่างและประสิทธิภาพ", label: "ค่าใช้จ่ายดำเนินงานต่อรายได้รวม", unit: "%", better: "lower", f: (k) => (val("total_opex", k) / rev(k)) * 100, formula: "ค่าใช้จ่ายในการดำเนินงาน ÷ รายได้รวม" },
      { id: "opex_assets", cat: "ส่วนต่างและประสิทธิภาพ", label: "ค่าใช้จ่ายดำเนินงานต่อสินทรัพย์", unit: "%", better: "lower", f: (k) => (val("total_opex", k) / val("total_assets", k)) * 100, formula: "ค่าใช้จ่ายในการดำเนินงาน ÷ สินทรัพย์รวม" },
      { id: "loans_assets", cat: "คุณภาพสินทรัพย์", label: "เงินให้กู้ต่อสินทรัพย์รวม", unit: "%", better: null, f: (k) => (loans(k) / val("total_assets", k)) * 100, formula: "เงินให้กู้ ÷ สินทรัพย์รวม" },
      { id: "ldr", cat: "คุณภาพสินทรัพย์", label: "เงินให้กู้ต่อเงินรับฝาก (LDR)", unit: "%", better: null, f: (k) => (loans(k) / val("deposits", k)) * 100, formula: "เงินให้กู้ ÷ เงินรับฝาก" },
      { id: "problem_loans", cat: "คุณภาพสินทรัพย์", label: "ลูกหนี้มีปัญหาต่อเงินให้กู้", unit: "%", better: "lower", f: c.loans || (c.loanNotes && c.loanNotes.nonAccrual) ? (k) => { const p = problemLoans(c, k); return p == null ? null : (p / loans(k)) * 100; } : null, formula: "(ลูกหนี้ขาดสมาชิกภาพ + ลูกหนี้ตามคำพิพากษา + เงินให้กู้ที่ไม่ก่อให้เกิดรายได้) ÷ เงินให้กู้" },
      { id: "share_pm", cat: "ต่อสมาชิก", label: "ทุนเรือนหุ้นเฉลี่ยต่อสมาชิก", unit: "baht", better: "higher", f: m.total ? (k) => val("shares", k) / members(k) : null, formula: "ทุนเรือนหุ้น ÷ จำนวนสมาชิก" },
      { id: "dep_pm", cat: "ต่อสมาชิก", label: "เงินฝากสมาชิกเฉลี่ยต่อสมาชิก", unit: "baht", better: "higher", needs: ["dep_m_sav"], f: m.total ? (k) => sumIds(MEMBER_DEP_IDS, k) / members(k) : null, formula: "เงินรับฝากจากสมาชิก ÷ จำนวนสมาชิก" },
      { id: "profit_pm", cat: "ต่อสมาชิก", label: "กำไรสุทธิต่อสมาชิก", unit: "baht", better: "higher", f: m.total ? (k) => val("net_profit", k) / members(k) : null, formula: "กำไรสุทธิ ÷ จำนวนสมาชิก" },
      { id: "borrower_ratio", cat: "ต่อสมาชิก", label: "สมาชิกที่มีเงินกู้", unit: "%", better: null, f: m.borrowers ? (k) => (k === "y" ? (m.borrowers / m.total) * 100 : m.prevBorrowers ? (m.prevBorrowers / m.prevTotal) * 100 : null) : null, formula: "จำนวนผู้กู้ ÷ จำนวนสมาชิก" }
    ];

    const list = defs
      .filter((d) => d.f && (!d.needs || d.needs.every(has)))
      .map((d) => {
        const rep = rr[d.id];
        return Object.assign({}, d, {
          y: rep ? rep.y : d.f("y"),
          py: rep ? rep.py : d.f("py"),
          reported: !!rep,
          pyApprox: !rep && !!d.pyApprox,
          formula: rep ? `${d.formula} — ตามที่สหกรณ์รายงาน` : d.formula,
          benchmark: bench[d.id] != null ? bench[d.id] : null
        });
      })
      .concat((c.extraRatios || []).map((r) => Object.assign({ reported: true, benchmark: null }, r)));

    return list.map((r) => {
      let trend = null;
      if (r.better && r.py != null && isFinite(r.py)) {
        const diff = r.y - r.py;
        if (Math.abs(diff) <= Math.abs(r.py) * 0.005) trend = "flat";
        else trend = (diff > 0) === (r.better === "higher") ? "better" : "worse";
      }
      let vsBench = null;
      if (r.benchmark != null && r.better) vsBench = (r.y >= r.benchmark) === (r.better === "higher") ? "better" : "worse";
      return Object.assign(r, { trend, vsBench });
    });
  }

  function computeFindings(c, A) {
    const { val, has, sumIds } = A;
    const R = {};
    A.ratios.forEach((r) => (R[r.id] = r));
    const F = [];
    const add = (sev, topic, title, detail, tab) => F.push({ sev, topic, title, detail, tab });
    const yr = c.report.year;
    const pyr = c.report.prevYear;
    const np = val("net_profit", "y");
    const npp = val("net_profit", "py");
    const loansY = val("st_loans", "y") + val("lt_loans", "y");
    const loansP = val("st_loans", "py") + val("lt_loans", "py");
    const borrowY = sumIds(BORROW_IDS, "y");
    const borrowP = sumIds(BORROW_IDS, "py");
    const hist = c.history || [];
    const longHistory = hist.length >= 5;

    // ผลประกอบการ
    {
      const g = growth(np, npp);
      let d = `กำไรสุทธิปี ${yr} ${M(np)} เทียบกับ ${M(npp)} ในปี ${pyr}`;
      if (longHistory) {
        const prior = hist.filter((h) => h.year < yr);
        if (np > Math.max(...prior.map((h) => h.profit))) d += ` และเป็นกำไรสูงสุดในรอบ ${hist.length} ปีที่มีข้อมูล`;
        const first = hist[0];
        const n = yr - first.year;
        if (n > 0) d += ` (เติบโตเฉลี่ย ${pct((Math.pow(np / first.profit, 1 / n) - 1) * 100)} ต่อปีนับจากปี ${first.year})`;
      }
      if (c.plan && c.plan.current) d += ` คิดเป็น ${pct((np / c.plan.current.profitPlan) * 100)} ของเป้าหมาย ${M(c.plan.current.profitPlan)}`;
      if (g < 0 && c.profitContext) d += ` — ${c.profitContext}`;
      add(g >= 0 ? "good" : c.profitContext ? "watch" : "risk", "ผลประกอบการ", `กำไรสุทธิ${g >= 0 ? "เพิ่มขึ้น" : "ลดลง"} ${pct(Math.abs(g))} เป็น ${M(np)}`, d, "statements");
    }

    // คุณภาพกำไร
    if (has("inc_gain") && np > 0) {
      const gain = val("inc_gain", "y");
      const gainP = val("inc_gain", "py");
      const share = (gain / np) * 100;
      if (share >= 10) {
        const core = np - gain;
        const coreP = npp - gainP;
        const cg = growth(core, coreP);
        add("watch", "คุณภาพกำไร", `กำไร ${pct(share)} มาจากการขายเงินลงทุน`,
          `กำไรจากการจำหน่ายเงินลงทุน ${M(gain)} (ปีก่อน ${M(gainP)}) เป็นรายการที่ไม่เกิดขึ้นประจำ หากไม่นับรายการนี้ กำไรจะเป็น ${M(core)} ${cg >= 0 ? "เพิ่มขึ้น" : "ลดลง"}เพียง ${pct(Math.abs(cg))} จากปีก่อน (${M(coreP)})${has("inc_invest") ? ` ส่วนผลตอบแทนจากเงินลงทุน (เงินปันผล/ดอกเบี้ย) เป็น ${M(val("inc_invest", "y"))}` : ""}`,
          "statements");
      }
    }

    // แหล่งเงินทุน
    if (R.coopdep_share) {
      const cs = R.coopdep_share;
      const sev = cs.y >= 50 ? "risk" : cs.y >= 30 ? "watch" : "good";
      let d = `เงินรับฝากจากสหกรณ์อื่น ${M(val("dep_coop", "y"))} คิดเป็น ${pct(cs.y)} ของเงินรับฝากทั้งหมด (ปีก่อน ${pct(cs.py)})`;
      const sp = c.interestExpenseSplit;
      if (sp) d += ` ดอกเบี้ยจ่ายให้สหกรณ์อื่น ${M(sp.coopDeposits.y)} เพิ่มขึ้น ${pct(growth(sp.coopDeposits.y, sp.coopDeposits.py))} และสูงกว่าดอกเบี้ยจ่ายเงินฝากสมาชิก (${M(sp.memberDeposits.y)})`;
      if (borrowY > 0) {
        d += ` นอกจากนี้มีเงินกู้ยืม ${M(borrowY)} (ปีก่อน ${M(borrowP)}) รวมแหล่งเงินทุนจากภายนอกเป็น ${pct(R.ext_funding.y)} ของสินทรัพย์`;
        const lenders = (c.creditLines || []).filter((l) => l.kind === "เงินกู้ยืม" && l.balance > 0).sort((a, b) => b.balance - a.balance);
        if (lenders.length) d += ` จาก ${lenders.length} แหล่ง รายใหญ่สุดคือ ${lenders[0].lender.replace(/\s*\(.*\)$/, "")} (${pct((lenders[0].balance / borrowY) * 100)} ของเงินกู้ยืม)`;
      }
      d += ` เงินทุนประเภทนี้อ่อนไหวต่ออัตราดอกเบี้ยและอาจถูกเรียกคืนพร้อมกันในวงเงินสูง`;
      if (R.liquid_coopdep) d += ` ณ สิ้นปีสินทรัพย์สภาพคล่องรองรับเงินรับฝากจากสหกรณ์อื่นได้ ${pct(R.liquid_coopdep.y)} (ปีก่อน ${pct(R.liquid_coopdep.py)})`;
      add(sev, "แหล่งเงินทุน", `พึ่งพาเงินฝากจากสหกรณ์อื่นถึง ${pct(cs.y)} ของเงินรับฝาก`, d, "portfolio");
    }

    // สภาพคล่อง
    if (R.current_ratio) {
      const cr = R.current_ratio;
      const lq = R.liquid_dep;
      const low = lq && lq.y < 2;
      const belowBench = cr.benchmark != null && cr.y < cr.benchmark;
      const sev = low || (cr.benchmark != null && cr.y < cr.benchmark * 0.5) ? "risk" : belowBench || cr.trend === "worse" ? "watch" : "good";
      let d = `อัตราส่วนทุนหมุนเวียน ${fmtUnit(cr.y, "x")} (ปีก่อน ${fmtUnit(cr.py, "x")}${cr.benchmark != null ? `, ค่าเฉลี่ยสหกรณ์ออมทรัพย์ ${fmtUnit(cr.benchmark, "x")}` : ""})`;
      if (lq) d += ` เงินสด เงินฝาก และเงินลงทุนระยะสั้นรวม ${M(val("cash", "y") + val("dep_coops", "y") + val("st_invest", "y"))} คิดเป็น ${pct(lq.y)} ของเงินรับฝาก`;
      if (c.report.liquidityRequirementPct) d += ` (หมายเหตุประกอบงบระบุเกณฑ์ดำรงสินทรัพย์สภาพคล่องไม่ต่ำกว่า ${c.report.liquidityRequirementPct}% ของเงินรับฝาก ซึ่งการคำนวณตามกฎกระทรวงอาจนับรายการที่ไม่ได้แยกแสดงในงบ)`;
      if (has("cur_ltb") && val("cur_ltb", "y") > 0) d += ` ขณะที่เงินกู้ยืมที่ถึงกำหนดชำระภายในหนึ่งปีมี ${M(val("cur_ltb", "y"))}`;
      const cashEnd = val("cf_end", "y");
      const cashEndP = val("cf_end", "py");
      if (cashEnd != null) {
        const diff = cashEnd - cashEndP;
        d += ` เงินสดและรายการเทียบเท่าเงินสด${diff >= 0 ? "เพิ่มขึ้น" : "ลดลง"} ${M(Math.abs(diff))} เป็น ${M(cashEnd)}`;
        const parts = [];
        if (has("cfo")) parts.push(`กิจกรรมดำเนินงาน ${M(val("cfo", "y"))}`);
        if (has("cfi")) parts.push(`กิจกรรมลงทุน ${M(val("cfi", "y"))}`);
        const depNet = (val("cf_dep_in", "y") || 0) + (val("cf_dep_out", "y") || 0);
        if (has("cf_dep_in")) parts.push(`เงินรับฝากสุทธิ ${M(depNet)}`);
        if (has("cf_pn_net")) parts.push(`เงินกู้ยืมสุทธิ ${M(val("cf_pn_net", "y"))}`);
        if (parts.length) d += ` (${parts.join(", ")})`;
      }
      const title = low
        ? `สภาพคล่องต่ำ: สินทรัพย์สภาพคล่องเพียง ${pct(lq.y)} ของเงินรับฝาก`
        : `สภาพคล่อง${cr.trend === "worse" ? "ลดลง" : cr.trend === "better" ? "ดีขึ้น" : "ทรงตัว"} อัตราส่วนทุนหมุนเวียน ${fmtUnit(cr.y, "x")}`;
      add(sev, "สภาพคล่อง", title, d, "ratios");
    }

    // ส่วนต่างดอกเบี้ย
    if (R.spread && R.spread.py != null) {
      const sp = R.spread;
      const drop = sp.py - sp.y;
      add(drop > 0.5 ? "watch" : drop < -0.25 ? "good" : "info", "ส่วนต่างดอกเบี้ย",
        `ส่วนต่างดอกเบี้ย${drop > 0 ? "แคบลง" : "กว้างขึ้น"}เป็น ${nf2.format(sp.y)} จุด`,
        `ผลตอบแทนเงินให้กู้ประมาณ ${pct(R.loan_yield.y)} (ปีก่อน ${pct(R.loan_yield.py)}) ขณะที่ต้นทุนเงินทุน (ดอกเบี้ยจ่าย ÷ เงินรับฝากและเงินกู้ยืม) ประมาณ ${pct(R.cost_funds.y)} (ปีก่อน ${pct(R.cost_funds.py)}) ส่วนต่างจึงเปลี่ยนจาก ${nf2.format(sp.py)} จุด เป็น ${nf2.format(sp.y)} จุด (คำนวณจากยอดคงเหลือ ณ สิ้นปี)`,
        "ratios");
    }

    // เงินลงทุน
    if (has("unrealized") && val("unrealized", "y") < 0) {
      const u = val("unrealized", "y");
      const uP = val("unrealized", "py");
      const eq = val("total_equity", "y");
      const inv = c.investments || [];
      const gap = (kind) => sum(inv.filter((i) => i.kind === kind).map((i) => i.fair - i.cost));
      const total = sum(inv.map((i) => i.fair));
      const totalP = sum(inv.map((i) => i.pyFair));
      let d = `เพิ่มจาก ${M(-uP)} ในปีก่อน คิดเป็น ${pct((-u / eq) * 100)} ของทุนสหกรณ์`;
      if (inv.length) d += ` แยกเป็นพันธบัตรรัฐบาลต่ำกว่าทุน ${M(-gap("ตราสารหนี้"))} และหุ้นสามัญต่ำกว่าทุน ${M(-gap("ตราสารทุน"))} เงินลงทุนรวมเพิ่มเป็น ${M(total)} (${spct(growth(total, totalP))})`;
      if (has("cf_eq_buy") && has("cf_inv_sell")) d += ` ระหว่างปีซื้อหุ้นกู้/หุ้นทุน ${M(-val("cf_eq_buy", "y"))} และขายออก ${M(val("cf_inv_sell", "y"))} ซึ่งเป็นการหมุนเวียนสูงเมื่อเทียบกับพอร์ต`;
      add(Math.abs(u) / eq >= 0.01 ? "watch" : "info", "เงินลงทุน", `ขาดทุนจากเงินลงทุนที่ยังไม่เกิดขึ้น ${M(-u)}`, d, "portfolio");
    }

    // คุณภาพสินเชื่อ
    if (R.problem_loans) {
      const pl = R.problem_loans;
      const na = c.loanNotes && c.loanNotes.nonAccrual;
      const naJump = na && na.y > Math.max(na.py * 2, loansY * 0.001);
      const sev = pl.y >= 3 ? "risk" : pl.y >= 1 || naJump ? "watch" : "good";
      let d = `ลูกหนี้ขาดสมาชิกภาพ ลูกหนี้ตามคำพิพากษา${na ? " และเงินให้กู้ที่ไม่ก่อให้เกิดรายได้" : ""}รวม ${M(problemLoans(c, "y"))} คิดเป็น ${pct(pl.y)} ของเงินให้กู้ (ปีก่อน ${pct(pl.py)})`;
      if (na) {
        const naChange = na.py == null ? `${M(na.y)}` : `${na.y > na.py ? "เพิ่มจาก" : na.y < na.py ? "ลดลงจาก" : "คงที่จาก"} ${M(na.py)} เป็น ${M(na.y)}`;
        d += ` โดยเงินให้กู้ที่ไม่ก่อให้เกิดรายได้${naChange}${na.note ? ` — ${na.note}` : ""}`;
        const al = c.loanNotes.allowance;
        if (al && al.y != null) d += ` ค่าเผื่อหนี้สงสัยจะสูญครอบคลุม ${pct((al.y / na.y) * 100)} ของยอดนี้`;
      }
      const mo = c.loanNotes && c.loanNotes.moratorium;
      if (mo) d += ` นอกจากนี้มีสมาชิกขอพักชำระหนี้เงินต้น ${nf0.format(mo.members)} ราย ${nf0.format(mo.contracts)} สัญญา รวม ${M(mo.amount)} ควรติดตามความสามารถชำระหนี้เมื่อสิ้นสุดการพัก`;
      const title = naJump
        ? `เงินให้กู้ที่ไม่ก่อให้เกิดรายได้เพิ่มเป็น ${M(na.y)}`
        : `หนี้มีปัญหา${sev === "good" ? "อยู่ในระดับต่ำ" : "ควรติดตาม"} ${pct(pl.y)} ของเงินให้กู้`;
      add(sev, "คุณภาพสินเชื่อ", title, d, "portfolio");
    }

    // โครงสร้างเงินทุน
    if (R.de_ratio) {
      const de = R.de_ratio;
      const above = de.benchmark != null && de.y > de.benchmark;
      let d = `D/E ${fmtUnit(de.y, "x")} (ปีก่อน ${fmtUnit(de.py, "x")})`;
      if (de.benchmark != null) d += ` ${above ? "สูงกว่า" : "ต่ำกว่า"}ค่าเฉลี่ยสหกรณ์ออมทรัพย์ ${fmtUnit(de.benchmark, "x")}`;
      if (R.equity_assets) d += ` ทุนของสหกรณ์คิดเป็น ${pct(R.equity_assets.y)} ของสินทรัพย์ (ปีก่อน ${pct(R.equity_assets.py)})`;
      add(above ? "watch" : "good", "โครงสร้างเงินทุน", `หนี้สินต่อทุน${de.trend === "better" ? "ลดลงเป็น" : ""} ${fmtUnit(de.y, "x")}${above ? (de.trend === "better" ? " แต่ยังสูงกว่าค่าเฉลี่ย" : " สูงกว่าค่าเฉลี่ย") : ""}`, d, "ratios");
    }

    // ROE / ROA
    if (R.roe && R.roa && R.roe.benchmark != null && R.roa.benchmark != null) {
      const eAbove = R.roe.y >= R.roe.benchmark;
      const aAbove = R.roa.y >= R.roa.benchmark;
      const sev = eAbove && aAbove ? "good" : !eAbove && !aAbove ? "watch" : "info";
      const title = eAbove && aAbove
        ? `ROE ${pct(R.roe.y)} และ ROA ${pct(R.roa.y)} สูงกว่าค่าเฉลี่ย`
        : !eAbove && !aAbove
          ? `ROE ${pct(R.roe.y)} และ ROA ${pct(R.roa.y)} ต่ำกว่าค่าเฉลี่ย`
          : `ROE ${pct(R.roe.y)} ${eAbove ? "สูงกว่า" : "ต่ำกว่า"}ค่าเฉลี่ย แต่ ROA ${pct(R.roa.y)} ${aAbove ? "สูงกว่า" : "ต่ำกว่า"}ค่าเฉลี่ย`;
      add(sev, "ความสามารถในการทำกำไร", title,
        `ROE ${pct(R.roe.y)} (ปีก่อน ${R.roe.pyApprox ? "≈" : ""}${pct(R.roe.py)}, ค่าเฉลี่ย ${pct(R.roe.benchmark)}) ROA ${pct(R.roa.y)} (ปีก่อน ${R.roa.pyApprox ? "≈" : ""}${pct(R.roa.py)}, ค่าเฉลี่ย ${pct(R.roa.benchmark)}) ${R.roe.reported ? "ตามที่สหกรณ์คำนวณในรายงาน" : "คำนวณจากยอดถัวเฉลี่ยต้นปีและสิ้นปี"}${eAbove && !aAbove ? " เมื่อ ROE สูงแต่ ROA ต่ำกว่าค่าเฉลี่ย แสดงว่าผลตอบแทนต่อทุนได้มาจากการใช้หนี้สินในสัดส่วนสูง" : !eAbove && aAbove ? " เมื่อ ROA สูงแต่ ROE ต่ำกว่าค่าเฉลี่ย แสดงว่าสินทรัพย์ทำกำไรได้ดี แต่สหกรณ์ใช้ทุนของตนเองในสัดส่วนสูง ผลตอบแทนต่อทุนจึงต่ำกว่าค่าเฉลี่ย" : ""}`,
        "ratios");
    }
    if (R.npm && R.npm.benchmark != null && R.npm.y < R.npm.benchmark) {
      const ie = (val("total_int_exp", "y") / val("total_int_income", "y")) * 100;
      const ieP = (val("total_int_exp", "py") / val("total_int_income", "py")) * 100;
      add("watch", "ความสามารถในการทำกำไร", `อัตรากำไรสุทธิ ${pct(R.npm.y)} ต่ำกว่าค่าเฉลี่ย ${pct(R.npm.benchmark)}`,
        `ดอกเบี้ยจ่ายคิดเป็น ${pct(ie)} ของรายได้ดอกเบี้ยและผลตอบแทน (ปีก่อน ${pct(ieP)}) ต้นทุนเงินทุนที่สูงเป็นปัจจัยหลักที่ทำให้อัตรากำไรต่ำกว่าสหกรณ์ออมทรัพย์โดยเฉลี่ย`,
        "ratios");
    }

    // ผลตอบแทนแก่สมาชิก และการจัดสรรทุนสำรอง
    if (hist.length >= 1) {
      const h = hist[hist.length - 1];
      const prior = hist.slice(0, -1);
      const prev = prior[prior.length - 1];
      const record = longHistory && h.refundRate != null && h.dividendRate > Math.max(...prior.map((p) => p.dividendRate)) && h.refundRate > Math.max(...prior.map((p) => p.refundRate));
      const toMembers = ((h.dividend + h.refund) / h.profit) * 100;
      add("good", "ผลตอบแทนแก่สมาชิก", `ปันผล ${pct(h.dividendRate)} เฉลี่ยคืน ${refundText(h)}${record ? ` สูงสุดในรอบ ${hist.length} ปี` : ""}`,
        `จัดสรรเป็นเงินปันผล ${M(h.dividend)} และเงินเฉลี่ยคืน ${M(h.refund)} รวม ${pct(toMembers)} ของกำไรสุทธิ${prev ? ` (ปีก่อนปันผล ${pct(prev.dividendRate)} เฉลี่ยคืน ${refundText(prev)})` : ""}`,
        "trends");
      if (prior.length >= 3 && h.reserve != null && prior.every((p) => p.reserve != null)) {
        const resShare = (h.reserve / h.profit) * 100;
        const avgPrior = sum(prior.map((p) => (p.reserve / p.profit) * 100)) / prior.length;
        if (resShare > avgPrior + 2) {
          add("good", "โครงสร้างเงินทุน", `จัดสรรเข้าทุนสำรอง ${pct(resShare)} ของกำไร`,
            `จัดสรร ${M(h.reserve)} สูงกว่าค่าเฉลี่ย ${pct(avgPrior)} ของ ${prior.length} ปีก่อนหน้า ช่วยเสริมความมั่นคงของเงินทุน (ทุนสำรองก่อนจัดสรร ${M(val("reserve", "y"))})`,
            "trends");
        }
      }
    }

    // สินเชื่อ
    {
      const lg = growth(loansY, loansP);
      let d = `เงินให้กู้รวม ${M(loansY)} เพิ่มขึ้น ${pct(lg)} จาก ${M(loansP)}`;
      if (has("cf_loan_out")) d += ` ระหว่างปีจ่ายเงินให้กู้ ${M(-val("cf_loan_out", "y"))} (ปีก่อน ${M(-val("cf_loan_out", "py"))}) และรับชำระ ${M(val("cf_loan_in", "y"))}`;
      const line = c.plan && c.plan.revenueLines ? c.plan.revenueLines.find((l) => l.name.indexOf("เงินให้กู้") >= 0) : null;
      const belowPlan = line && line.plan && line.actual < line.plan * 0.97;
      if (line && line.plan) d += ` ดอกเบี้ยรับจากเงินให้กู้ ${M(line.actual)} คิดเป็น ${pct((line.actual / line.plan) * 100)} ของประมาณการ`;
      if (line && line.next) d += ` ปีหน้าประมาณการดอกเบี้ยรับจากเงินให้กู้ไว้ ${M(line.next)} (${spct(growth(line.next, line.actual))})`;
      const weak = lg < 5 || belowPlan;
      add(weak ? "watch" : "good", "สินเชื่อ", weak ? `สินเชื่อเติบโตเพียง ${pct(lg)}${belowPlan ? " และรายได้ดอกเบี้ยต่ำกว่าประมาณการ" : ""}` : `สินเชื่อเติบโต ${pct(lg)}`, d, "portfolio");
    }

    // ค่าใช้จ่าย
    {
      const oy = val("total_opex", "y");
      const op = val("total_opex", "py");
      const og = growth(oy, op);
      if (og != null && og > 15) {
        const opexGroups = new Set(A.items.filter((i) => i.level === 1 && i.st === "is" && i.sec === "ค่าใช้จ่าย" && i.group !== "ค่าใช้จ่ายดอกเบี้ย" && i.group !== "หนี้สงสัยจะสูญ").map((i) => i.group));
        const top = A.items.filter((i) => i.level === 2 && opexGroups.has(i.group)).sort((a, b) => b.change - a.change).slice(0, 3);
        add("watch", "ค่าใช้จ่าย", `ค่าใช้จ่ายดำเนินงานเพิ่มขึ้น ${pct(og)}`,
          `รวม ${M(oy)} (ปีก่อน ${M(op)}) รายการที่เพิ่มมากที่สุด: ${top.map((i) => `${i.label} +${amt(i.change)}`).join(", ")} ทั้งนี้ค่าใช้จ่ายดำเนินงานยังคิดเป็นเพียง ${pct(R.opex_rev ? R.opex_rev.y : null)} ของรายได้รวม`,
          "statements");
      }
    }

    // งบประมาณ
    if (c.budget) {
      const b = c.budget;
      const used = (b.total.actual / b.total.budget) * 100;
      const over = b.items.filter((i) => i.budget > 0 && i.actual > i.budget).sort((a, b2) => b2.actual / b2.budget - a.actual / a.budget);
      const unbudgeted = b.items.filter((i) => i.budget === 0 && i.actual > 0);
      let d = `${b.scope || "งบประมาณรายจ่าย"} ${M(b.total.budget)} ใช้จริง ${M(b.total.actual)}`;
      if (over.length) d += ` รายการที่ใช้เกินงบสูงสุด (ตามสัดส่วน): ${over.slice(0, 4).map((i) => `${i.name} ${pct((i.actual / i.budget) * 100)}`).join(", ")}`;
      if (unbudgeted.length) d += ` และมี ${unbudgeted.length} รายการที่ไม่ได้ตั้งงบไว้ (${unbudgeted.map((i) => i.name).join(", ")})`;
      add(used > 100 ? "watch" : "info", "งบประมาณ", `ใช้งบประมาณ ${pct(used)} มี ${over.length} รายการใช้เกินงบ`, d, "budget");
    }

    // สมาชิก
    if (c.members) {
      const m = c.members;
      const h = m.history || [];
      const last = h[h.length - 1];
      const hasFlow = last && last.left != null;
      const highExit = hasFlow && h.length > 2 && last.left > Math.max(...h.slice(0, -1).map((x) => x.left));
      let d = hasFlow ? `สมาชิกใหม่ ${cnt(last.joined)} คน ออก ${cnt(last.left)} คน` : `สมาชิกสามัญ ${cnt(m.ordinary)} คน (ปีก่อน ${cnt(m.prevOrdinary)}) สมทบ ${cnt(m.associate)} คน (ปีก่อน ${cnt(m.prevAssociate)})`;
      if (highExit) {
        const ex = m.exits || m.exits2569 || {};
        d += ` จำนวนผู้ออกสูงที่สุดในรอบ ${h.length} ปี`;
        const parts = [["ลาออก", ex.resigned], ["ขาดจากสมาชิกภาพ", ex.lostMembership], ["ถึงแก่กรรม", ex.died], ["โอนย้าย", ex.transferred]].filter(([, v]) => v != null);
        if (parts.length) d += ` (${parts.map(([k, v]) => `${k} ${v}`).join(", ")})`;
      }
      if (m.borrowers) d += ` สมาชิกที่มีเงินกู้ ${cnt(m.borrowers)} คน (${pct((m.borrowers / m.total) * 100)})`;
      add(highExit ? "watch" : "good", "สมาชิก", `สมาชิกเพิ่มขึ้น ${pct(growth(m.total, m.prevTotal))} เป็น ${cnt(m.total)} คน${highExit ? " แต่ผู้ออกสูงสุดในรอบหลายปี" : ""}`, d, "trends");
    }

    // การกำกับดูแล
    if (c.report.opinion) {
      const clean = c.report.opinion.indexOf("ไม่มีเงื่อนไข") >= 0;
      add(clean ? "good" : "risk", "การกำกับดูแล", clean ? "ผู้สอบบัญชีแสดงความเห็นแบบไม่มีเงื่อนไข" : `ความเห็นผู้สอบบัญชี: ${c.report.opinion}`,
        `${c.report.auditor} ลงวันที่ ${c.report.auditDate}${c.report.internalControl ? ` ผลการประเมินชั้นคุณภาพการควบคุมภายในโดยรวมระดับ "${c.report.internalControl}"` : ""}`,
        "overview");
    }
    const weak = (c.report.internalControlParts || []).filter((p) => WEAK_CONTROL.includes(p.level));
    if (weak.length) {
      add("watch", "การกำกับดูแล", `การควบคุมภายในด้าน${weak.map((p) => p.name).join(" และ ")} อยู่ในระดับ "${weak[0].level}"`,
        `ผลการประเมินชั้นคุณภาพการควบคุมภายใน (แบบ RQ2) โดยรวมระดับ "${c.report.internalControl}" แต่ ${weak.map((p) => `${p.name} ระดับ "${p.level}"`).join(", ")} ต่ำกว่าด้านอื่น (${c.report.internalControlParts.filter((p) => !WEAK_CONTROL.includes(p.level)).map((p) => `${p.name} "${p.level}"`).join(", ")})`,
        "overview");
    }

    // แผนปีถัดไป
    if (c.plan && c.plan.next) {
      const pn = c.plan.next.profit;
      let d = `ประมาณการรายได้ ${M(c.plan.next.revenue)} รายจ่าย ${M(c.plan.next.expense)}`;
      const down = (c.plan.revenueLines || []).filter((l) => l.next < l.actual).sort((a, b) => (a.next - a.actual) - (b.next - b.actual));
      if (down.length) d += ` โดยคาดว่า${down.slice(0, 2).map((l) => `${l.name} ลดลงเหลือ ${amt(l.next)}`).join(" และ")}`;
      add("info", "แผนปีถัดไป", `เป้ากำไรปี ${yr + 1} ${M(pn)} (${spct(growth(pn, np))} จากผลจริงปีนี้)`, d, "budget");
    }

    // คดีความและการร้องเรียน
    if (c.litigation) {
      const L = c.litigation;
      const cases = L.cases || [];
      const open = cases.filter((x) => x.status === "ongoing");
      const against = open.filter((x) => x.role === "จำเลย" || x.role === "ผู้ถูกกล่าวหา");
      if (!cases.length) {
        add("info", "คดีความ", "ไม่พบคดีความหรือการร้องเรียนที่เปิดเผยต่อสาธารณะ", `${L.disclosure || "รายงานประจำปีไม่ได้ระบุคดี"} ${L.searchNote || ""}`.trim(), "legal");
      } else {
        const amt0 = sum(open.map((x) => x.amount || 0));
        const sev = against.length ? "risk" : open.length ? "watch" : "info";
        add(sev, "คดีความ", `มีคดีที่เกี่ยวข้อง ${cases.length} เรื่อง ยังไม่สิ้นสุด ${open.length} เรื่อง${against.length ? ` (สหกรณ์เป็นฝ่ายถูกฟ้อง/ถูกกล่าวหา ${against.length} เรื่อง)` : ""}`,
          `${open.map((x) => x.title).join(" · ")}${amt0 ? ` มูลค่าที่เกี่ยวข้องรวม ${M(amt0)}` : ""}${L.disclosure ? ` — ${L.disclosure}` : ""}`, "legal");
      }
    }

    (c.customFindings || []).forEach((f) => add(f.sev, f.topic, f.title, f.detail, f.tab));

    // ความถูกต้องของรายงาน
    (c.dataNotes || []).forEach((n, i) => add("info", "ความถูกต้องของรายงาน", `ข้อสังเกตเกี่ยวกับตัวเลขในรายงาน (${i + 1})`, n, "findings"));

    return F.sort((a, b) => SEV[a.sev].rank - SEV[b.sev].rank);
  }

  // ------------------------------------------------------------ small UI helpers
  const main = document.getElementById("main");

  function sevBadge(sev) {
    const s = SEV[sev];
    return `<span class="sev sev-${sev}"><span class="sev-icon" aria-hidden="true">${s.icon}</span>${s.label}</span>`;
  }

  function delta(v, upIsGood, unit) {
    if (v == null || !isFinite(v)) return "";
    if (Math.abs(v) < 0.005) return `<span class="delta flat">● คงที่</span>`;
    const up = v > 0;
    const cls = upIsGood == null ? "flat" : up === upIsGood ? (up ? "up-good" : "down-good") : up ? "up-bad" : "down-bad";
    const txt = unit === "pt" ? `${up ? "+" : "−"}${nf2.format(Math.abs(v))} จุด` : unit === "x" ? `${up ? "+" : "−"}${nf2.format(Math.abs(v))} เท่า` : spct(v);
    return `<span class="delta ${cls}"><span aria-hidden="true">${up ? "▲" : "▼"}</span>${txt}</span>`;
  }

  function chip(group, value, label, pressed) {
    return `<button type="button" class="chip" data-chip="${group}" data-value="${esc(value)}" aria-pressed="${pressed}">${label}</button>`;
  }

  function option(value, label, selected) {
    return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  }

  function trendTag(r) {
    if (!r.trend) return `<span class="muted">–</span>`;
    if (r.trend === "flat") return `<span class="tag">ทรงตัว</span>`;
    return r.trend === "better" ? `<span class="pos">▲ ดีขึ้น</span>` : `<span class="neg">▼ แย่ลง</span>`;
  }

  function benchTag(r) {
    if (r.benchmark == null) return `<span class="muted">ไม่มีค่าเฉลี่ย</span>`;
    return r.vsBench === "better" ? `<span class="pos">ดีกว่าค่าเฉลี่ย</span>` : `<span class="neg">ด้อยกว่าค่าเฉลี่ย</span>`;
  }

  function pyCell(r) {
    const v = fmtUnit(r.py, r.unit);
    return r.pyApprox && v !== "–" ? `<span title="ปีก่อนคำนวณจากยอดสิ้นปี เพราะรายงานไม่มียอดต้นปีของปีก่อน">≈ ${v}</span>` : v;
  }

  function downloadCSV(name, rows) {
    const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  // ------------------------------------------------------------ views
  function renderOverview(c, A) {
    const v = A.val;
    const yr = c.report.year;
    const pyr = c.report.prevYear;
    const R = {};
    A.ratios.forEach((r) => (R[r.id] = r));
    const np = v("net_profit", "y");
    const hist = c.history || [];
    const h = hist[hist.length - 1];
    const hp = hist.length > 1 ? hist[hist.length - 2] : null;
    const loansY = v("st_loans", "y") + v("lt_loans", "y");
    const loansP = v("st_loans", "py") + v("lt_loans", "py");

    const kpis = [
      { label: "สินทรัพย์รวม", value: mb(v("total_assets", "y")), unit: "ล้านบาท", d: delta(growth(v("total_assets", "y"), v("total_assets", "py")), true) },
      { label: "เงินให้กู้แก่สมาชิก", value: mb(loansY), unit: "ล้านบาท", d: delta(growth(loansY, loansP), true) },
      { label: "เงินรับฝาก", value: mb(v("deposits", "y")), unit: "ล้านบาท", d: delta(growth(v("deposits", "y"), v("deposits", "py")), true) },
      { label: "ทุนเรือนหุ้น", value: mb(v("shares", "y")), unit: "ล้านบาท", d: delta(growth(v("shares", "y"), v("shares", "py")), true) },
      c.members ? { label: "สมาชิก", value: nf0.format(c.members.total), unit: "คน", d: delta(growth(c.members.total, c.members.prevTotal), true) } : null,
      R.roe ? { label: "ROE", value: nf2.format(R.roe.y), unit: "%", d: R.roe.pyApprox ? "" : delta(R.roe.y - R.roe.py, true, "pt"), vs: R.roe.benchmark != null ? `ค่าเฉลี่ย ${pct(R.roe.benchmark)}` : "" } : null,
      h ? { label: "อัตราเงินปันผล", value: nf2.format(h.dividendRate), unit: "%", d: hp ? delta(h.dividendRate - hp.dividendRate, true, "pt") : "" } : null,
      h ? (h.refundRate != null ? { label: "อัตราเงินเฉลี่ยคืน", value: nf2.format(h.refundRate), unit: "%", d: hp && hp.refundRate != null ? delta(h.refundRate - hp.refundRate, true, "pt") : "" } : { label: "อัตราเงินเฉลี่ยคืน", value: esc(h.refundRateText || "–"), unit: "" }) : null
    ].filter(Boolean);

    const top = A.findings.filter((f) => f.sev === "risk" || f.sev === "watch").slice(0, 5);
    const goods = A.findings.filter((f) => f.sev === "good").slice(0, 3);
    const plan = c.plan && c.plan.current;
    const next = c.plan && c.plan.next;

    main.innerHTML = `
      <div class="hero">
        <section class="card">
          <div class="muted small">กำไรสุทธิปีบัญชี ${yr}</div>
          <div class="hero-figure">${mb(np)}<span class="hero-unit">ล้านบาท</span></div>
          <div>${delta(growth(np, v("net_profit", "py")), true)} <span class="muted small">เทียบปี ${pyr} (${M(v("net_profit", "py"))})</span></div>
          <p class="sub" style="margin-top:10px">${plan ? `เป้าหมาย ${M(plan.profitPlan)} · ทำได้ ${pct((np / plan.profitPlan) * 100)} ของเป้า · ` : ""}รายได้รวม ${M(A.revenue("y"))} · ค่าใช้จ่ายรวม ${M(A.revenue("y") - np)}${!plan && next ? ` · เป้ากำไรปี ${yr + 1} ${M(next.profit)}` : ""}</p>
        </section>
        <section class="card">
          <h3>ข้อมูลรายงาน</h3>
          <dl class="meta-list">
            <dt>สหกรณ์</dt><dd>${esc(c.name)}</dd>
            <dt>รายงาน</dt><dd>${esc(c.report.title)}</dd>
            <dt>ปีบัญชีสิ้นสุด</dt><dd>${esc(c.report.fiscalYearEnd)}</dd>
            <dt>ผู้สอบบัญชี</dt><dd>${esc(c.report.auditor)}</dd>
            <dt>ความเห็น</dt><dd>${esc(c.report.opinion)}${c.report.internalControl ? ` · การควบคุมภายใน "${esc(c.report.internalControl)}"` : ""}</dd>
            <dt>ที่มา</dt><dd><a href="${esc(c.report.sourcePage)}" target="_blank" rel="noopener">${esc(c.website.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>${c.report.uploaded ? ` · อัปโหลด ${esc(c.report.uploaded)}` : ""}</dd>
          </dl>
        </section>
      </div>

      <section class="section kpis">
        ${kpis.map((k) => `<div class="card kpi"><div class="label">${esc(k.label)}${k.unit && k.unit !== "%" ? ` <span class="muted">(${esc(k.unit)})</span>` : ""}</div><div class="value">${k.value}${k.unit === "%" ? "%" : ""}</div>${k.d ? `<div>${k.d}</div>` : ""}${k.vs ? `<div class="vs">${esc(k.vs)}</div>` : ""}</div>`).join("")}
      </section>

      <section class="section grid grid-2">
        <div class="card">
          <h3>ประเด็นที่ควรติดตาม</h3>
          <p class="sub">ความเสี่ยงและเรื่องที่ควรเฝ้าระวังจากการวิเคราะห์</p>
          <div class="findings">${top.map(findingHTML).join("") || '<div class="empty">ไม่พบประเด็นเสี่ยง</div>'}</div>
          <button type="button" class="btn" data-goto="findings" style="margin-top:10px">ดูข้อค้นพบทั้งหมด (${A.findings.length})</button>
        </div>
        <div class="card">
          <h3>จุดแข็ง</h3>
          <p class="sub">ผลการดำเนินงานที่โดดเด่น</p>
          <div class="findings">${goods.map(findingHTML).join("")}</div>
          ${plan ? `<h3 style="margin-top:18px">ผลจริงเทียบประมาณการปี ${yr}</h3><p class="sub">ร้อยละของประมาณการ เส้นแนวตั้ง = 100%</p><div id="ov-plan"></div>` : ""}
        </div>
      </section>

      <section class="section grid grid-2">
        <div class="card">
          <h3>โครงสร้างสินทรัพย์</h3>
          <p class="sub">ร้อยละของสินทรัพย์รวม ${M(v("total_assets", "y"))}</p>
          ${C.legend([{ label: `ปี ${yr}`, color: "var(--series-1)" }, { label: `ปี ${pyr}`, kind: "tick" }])}
          <div id="ov-assets"></div>
        </div>
        <div class="card">
          <h3>แหล่งที่มาของเงินทุน</h3>
          <p class="sub">ร้อยละของหนี้สินและทุนรวม</p>
          ${C.legend([{ label: `ปี ${yr}`, color: "var(--series-1)" }, { label: `ปี ${pyr}`, kind: "tick" }])}
          <div id="ov-funding"></div>
        </div>
      </section>`;

    const share = (ids, k) => (A.sumIds(ids, k) / v("total_assets", k)) * 100;
    const structRows = (defs) => defs
      .filter(([, ids]) => ids.some((id) => A.has(id)) && (A.sumIds(ids, "y") !== 0 || A.sumIds(ids, "py") !== 0))
      .map(([label, ids]) => {
        const y = share(ids, "y");
        const py = share(ids, "py");
        return { label, value: y, prev: py, valueText: pct(y), tip: `<div class="t-title">${esc(label)}</div><div>ปี ${yr}: ${pct(y)} (${M(A.sumIds(ids, "y"))})</div><div>ปี ${pyr}: ${pct(py)}</div>` };
      })
      .sort((a, b) => b.value - a.value);
    C.hbars(document.getElementById("ov-assets"), structRows([
      ["เงินให้กู้แก่สมาชิก", ["st_loans", "lt_loans", "accr_int"]],
      ["เงินฝากสหกรณ์อื่น", ["dep_coops"]],
      ["เงินลงทุน", ["st_invest", "lt_invest"]],
      ["เงินสดและเงินฝากธนาคาร", ["cash"]],
      ["ที่ดิน อาคารและอุปกรณ์", ["ppe"]],
      ["อื่น ๆ", ["other_ca", "intangible", "guarantee"]]
    ]), { max: 100 });
    C.hbars(document.getElementById("ov-funding"), structRows([
      ["เงินรับฝากจากสหกรณ์อื่น", ["dep_coop"]],
      ["เงินรับฝากจากสมาชิก", MEMBER_DEP_IDS],
      ["เงินรับฝากอื่น", ["dep_assoc"]],
      ["เงินกู้ยืม", BORROW_IDS],
      ["ทุนเรือนหุ้น", ["shares"]],
      ["ทุนสำรองและทุนสะสม", ["reserve", "funds"]],
      [A.has("unrealized") ? "กำไรสุทธิและผลต่างมูลค่าเงินลงทุน" : "กำไรสุทธิประจำปี", ["bs_profit", "unrealized"]],
      ["หนี้สินอื่น", ["other_cl", "pension", "constr_guar", "staff_guar"]]
    ]), { max: 100 });

    if (plan) {
      const rows = [
        { label: "รายได้", plan: plan.revenuePlan, actual: plan.revenue },
        { label: "ค่าใช้จ่าย", plan: plan.expensePlan, actual: plan.expense },
        { label: "กำไรสุทธิ", plan: plan.profitPlan, actual: plan.profit }
      ].map((r) => {
        const p = (r.actual / r.plan) * 100;
        return { label: r.label, value: p, valueText: pct(p), tip: `<div class="t-title">${esc(r.label)}</div><div>ประมาณการ ${M(r.plan)}</div><div>ผลจริง ${M(r.actual)}</div>` };
      });
      C.hbars(document.getElementById("ov-plan"), rows, { max: 130, ref: 100 });
    }
  }

  function findingHTML(f) {
    const target = TABS.find((t) => t.id === f.tab);
    return `<article class="finding sev-${f.sev}">
      <div class="rail" aria-hidden="true"></div>
      <div>
        <div class="finding-head">${sevBadge(f.sev)}<span class="tag">${esc(f.topic)}</span>${f.coop ? `<span class="tag">${esc(f.coop)}</span>` : ""}</div>
        <h3>${esc(f.title)}</h3>
        <p>${esc(f.detail)}</p>
        ${target && f.tab !== state.tab && f.tab !== "findings" && f.tab !== "overview" ? `<button type="button" class="goto" data-goto="${f.tab}">ดูรายละเอียดใน${esc(target.label)} →</button>` : ""}
      </div>
    </article>`;
  }

  // ---------------- statements
  function filteredStatementItems(A) {
    const f = state.st;
    const q = f.q.trim().toLowerCase();
    let rows = A.items.filter((i) => {
      if (f.statement !== "all" && i.st !== f.statement) return false;
      if (f.sec !== "all" && i.sec !== f.sec) return false;
      if (f.level === "main" && i.level > 1) return false;
      if (f.level === "totals" && i.level !== 0) return false;
      if (f.level === "detail" && i.level === 0) return false;
      if (f.dir === "up" && !(i.change > 0)) return false;
      if (f.dir === "down" && !(i.change < 0)) return false;
      if (f.minPct > 0 && !(i.isNew || (i.pct != null && Math.abs(i.pct) >= f.minPct))) return false;
      if (q && (i.label + " " + i.group + " " + i.sec).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (f.sort !== "order") {
      const key = { y: (i) => i.y, change: (i) => i.change, abschange: (i) => Math.abs(i.change), pct: (i) => (i.pct == null ? (i.isNew ? Infinity : -Infinity) : i.pct), share: (i) => (i.share == null ? -Infinity : i.share) }[f.sort];
      rows = rows.slice().sort((a, b) => (key(a) - key(b)) * f.sortDir);
    }
    return rows;
  }

  function renderStatements(c, A) {
    const f = state.st;
    const secs = [...new Set(A.items.filter((i) => f.statement === "all" || i.st === f.statement).map((i) => i.sec))];
    if (f.sec !== "all" && !secs.includes(f.sec)) f.sec = "all";
    const yr = c.report.year;
    const pyr = c.report.prevYear;
    main.innerHTML = `
      <div class="section-head"><div><h2>งบการเงินเปรียบเทียบ ปี ${yr} กับ ${pyr}</h2><p>ตัวเลขจากงบที่ผ่านการตรวจสอบ หน่วย: บาท · สัดส่วน = ร้อยละของสินทรัพย์รวม (งบฐานะการเงิน) หรือของรายได้รวม (งบกำไรขาดทุน)</p></div></div>
      <div class="filters" role="group" aria-label="ตัวกรองงบการเงิน">
        <label class="field"><span class="field-label">งบ</span>
          <select data-f="st.statement">${option("all", "ทุกงบ", f.statement === "all")}${Object.keys(ST_LABEL).map((k) => option(k, ST_LABEL[k], f.statement === k)).join("")}</select></label>
        <label class="field"><span class="field-label">หมวด</span>
          <select data-f="st.sec">${option("all", "ทุกหมวด", f.sec === "all")}${secs.map((s) => option(s, s, f.sec === s)).join("")}</select></label>
        <label class="field"><span class="field-label">ระดับรายการ</span>
          <select data-f="st.level">${option("main", "รายการหลัก", f.level === "main")}${option("all", "ทุกรายการ (รวมรายการย่อย)", f.level === "all")}${option("detail", "เฉพาะรายการย่อย", f.level === "detail")}${option("totals", "เฉพาะยอดรวม", f.level === "totals")}</select></label>
        <div class="field"><span class="field-label">ทิศทาง</span>
          <div class="chips">${chip("st.dir", "all", "ทั้งหมด", f.dir === "all")}${chip("st.dir", "up", "▲ เพิ่มขึ้น", f.dir === "up")}${chip("st.dir", "down", "▼ ลดลง", f.dir === "down")}</div></div>
        <label class="field"><span class="field-label">เปลี่ยนแปลงอย่างน้อย</span>
          <span class="range-wrap"><input type="range" min="0" max="100" step="5" value="${f.minPct}" data-f="st.minPct" aria-label="เปลี่ยนแปลงอย่างน้อย (ร้อยละ)"><output>≥ ${f.minPct}%</output></span></label>
        <label class="field grow"><span class="field-label">ค้นหารายการ</span>
          <input type="search" placeholder="เช่น ดอกเบี้ย, เงินลงทุน" value="${esc(f.q)}" data-f="st.q"></label>
        <button type="button" class="btn" id="csv-st">ดาวน์โหลด CSV</button>
      </div>
      <div id="st-table"></div>`;
    drawStatementTable(c, A);
    document.getElementById("csv-st").addEventListener("click", () => {
      const rows = filteredStatementItems(A);
      downloadCSV(`${c.id}-${yr}-statements.csv`, [["งบ", "หมวด", "กลุ่ม", "รายการ", `ปี ${yr}`, `ปี ${pyr}`, "เปลี่ยนแปลง", "ร้อยละเปลี่ยนแปลง", "สัดส่วน", "หน้า"]].concat(
        rows.map((i) => [ST_LABEL[i.st], i.sec, i.group, i.label, i.y.toFixed(2), i.py.toFixed(2), i.change.toFixed(2), i.pct == null ? "" : i.pct.toFixed(2), i.share == null ? "" : i.share.toFixed(2), i.page])
      ));
    });
  }

  function drawStatementTable(c, A) {
    const f = state.st;
    const rows = filteredStatementItems(A);
    const yr = c.report.year;
    const pyr = c.report.prevYear;
    const th = (key, label, cls) => {
      const active = f.sort === key;
      return `<th class="sortable ${cls || ""}" data-sort="${key}" aria-sort="${active ? (f.sortDir > 0 ? "ascending" : "descending") : "none"}">${label}${active ? `<span class="sort-ind">${f.sortDir > 0 ? "↑" : "↓"}</span>` : ""}</th>`;
    };
    const bar = (p) => {
      if (p == null) return "";
      const w = Math.min(50, (Math.abs(p) / 100) * 50);
      return `<span class="chg-bar" aria-hidden="true"><span class="${p >= 0 ? "up" : "down"}" style="width:${w}%"></span></span>`;
    };
    const host = document.getElementById("st-table");
    host.innerHTML = `
      <div class="section-head"><span class="filter-summary">แสดง ${rows.length} จาก ${A.items.length} รายการ${f.sort !== "order" ? ` · <button type="button" class="goto" data-sort-reset>เรียงตามลำดับในงบ</button>` : ""}</span></div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>รายการ</th><th>หมวด</th>
          ${th("y", `ปี ${yr}`, "r")}<th class="r">ปี ${pyr}</th>
          ${th("change", "เปลี่ยนแปลง (บาท)", "r")}${th("pct", "%", "r")}<th>ทิศทาง</th>
          ${th("share", "สัดส่วน", "r")}<th>หน้า</th>
        </tr></thead>
        <tbody>${rows.length ? rows.map((i) => `<tr class="lvl-${i.level}">
          <td>${esc(i.label)}</td>
          <td><span class="tag">${esc(i.group)}</span></td>
          <td class="r num">${baht(i.y)}</td>
          <td class="r num">${baht(i.py)}</td>
          <td class="r num">${i.change === 0 ? "–" : (i.change > 0 ? "+" : "−") + nf2.format(Math.abs(i.change))}</td>
          <td class="r num">${i.isNew ? '<span class="tag">ใหม่</span>' : spct(i.pct)}</td>
          <td>${bar(i.isNew ? 100 : i.pct)}</td>
          <td class="r num">${i.share == null ? "–" : pct(i.share)}</td>
          <td class="page-ref">น.${i.page}</td></tr>`).join("") : `<tr><td colspan="9" class="empty">ไม่มีรายการที่ตรงกับตัวกรอง</td></tr>`}
        </tbody></table></div>`;
  }

  // ---------------- ratios
  function renderRatios(c, A) {
    const f = state.ratio;
    const rows = A.ratios.filter((r) => {
      if (f.cat !== "all" && r.cat !== f.cat) return false;
      if (f.trend !== "all" && r.trend !== f.trend) return false;
      if (f.bench === "has" && r.benchmark == null) return false;
      if (f.bench === "better" && r.vsBench !== "better") return false;
      if (f.bench === "worse" && r.vsBench !== "worse") return false;
      return true;
    });
    const cats = RATIO_CATS.filter((cat) => A.ratios.some((r) => r.cat === cat));
    const bench = A.ratios.filter((r) => r.benchmark != null);
    const benchInfo = BENCH[c.type];
    const yr = c.report.year;
    const pyr = c.report.prevYear;
    main.innerHTML = `
      <div class="section-head"><div><h2>อัตราส่วนทางการเงิน</h2><p>${esc(benchInfo ? benchInfo.note : "ไม่มีค่าเฉลี่ยเปรียบเทียบสำหรับประเภทสหกรณ์นี้")}</p></div></div>
      <section class="section">
        <div class="grid grid-3">${bench.map((r) => `<div class="card"><h3>${esc(r.label)}</h3><p class="sub">${esc(r.formula)}</p><div class="kpi"><div class="value">${fmtUnit(r.y, r.unit)}</div><div>${delta(r.y - r.py, r.better === "higher", r.unit === "x" ? "x" : "pt")} <span class="vs">ปีก่อน ${r.pyApprox ? "≈ " : ""}${fmtUnit(r.py, r.unit)} · ค่าเฉลี่ย ${fmtUnit(r.benchmark, r.unit)}</span></div></div><div style="margin-top:10px" data-bench="${r.id}"></div>${C.legend([{ label: `ปี ${yr}`, color: "var(--series-1)" }, { label: `ปี ${pyr}`, kind: "tick" }, { label: "ค่าเฉลี่ย", kind: "ref" }])}</div>`).join("")}</div>
      </section>
      <div class="filters" role="group" aria-label="ตัวกรองอัตราส่วน">
        <label class="field"><span class="field-label">หมวด</span>
          <select data-f="ratio.cat">${option("all", "ทุกหมวด", f.cat === "all")}${cats.map((cat) => option(cat, cat, f.cat === cat)).join("")}</select></label>
        <div class="field"><span class="field-label">แนวโน้มเทียบปีก่อน</span>
          <div class="chips">${chip("ratio.trend", "all", "ทั้งหมด", f.trend === "all")}${chip("ratio.trend", "better", "▲ ดีขึ้น", f.trend === "better")}${chip("ratio.trend", "worse", "▼ แย่ลง", f.trend === "worse")}${chip("ratio.trend", "flat", "ทรงตัว", f.trend === "flat")}</div></div>
        <label class="field"><span class="field-label">เทียบค่าเฉลี่ย</span>
          <select data-f="ratio.bench">${option("all", "ทั้งหมด", f.bench === "all")}${option("has", "เฉพาะที่มีค่าเฉลี่ย", f.bench === "has")}${option("better", "ดีกว่าค่าเฉลี่ย", f.bench === "better")}${option("worse", "ด้อยกว่าค่าเฉลี่ย", f.bench === "worse")}</select></label>
        <span class="filter-summary">แสดง ${rows.length} จาก ${A.ratios.length} อัตราส่วน</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>อัตราส่วน</th><th>หมวด</th><th class="r">ปี ${yr}</th><th class="r">ปี ${pyr}</th><th>แนวโน้ม</th><th class="r">ค่าเฉลี่ย</th><th>เทียบค่าเฉลี่ย</th><th>สูตร</th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => `<tr>
          <td>${esc(r.label)}${r.reported ? ' <span class="tag" title="ค่าตามที่รายงานระบุ">รายงาน</span>' : ""}</td>
          <td><span class="tag">${esc(r.cat)}</span></td>
          <td class="r num"><strong>${fmtUnit(r.y, r.unit)}</strong></td>
          <td class="r num">${pyCell(r)}</td>
          <td>${trendTag(r)}</td>
          <td class="r num">${r.benchmark == null ? "–" : fmtUnit(r.benchmark, r.unit)}</td>
          <td>${benchTag(r)}</td>
          <td class="small muted">${esc(r.formula)}</td></tr>`).join("") : `<tr><td colspan="8" class="empty">ไม่มีอัตราส่วนที่ตรงกับตัวกรอง</td></tr>`}</tbody>
      </table></div>
      <p class="small muted">อัตราส่วนที่มีป้าย "รายงาน" ใช้ค่าตามที่สหกรณ์คำนวณในรายงาน อัตราส่วนอื่นคำนวณจากงบการเงิน ROA/ROE ใช้ยอดถัวเฉลี่ยต้นปีและสิ้นปีเพื่อเทียบกับค่าเฉลี่ยได้ ส่วนค่า "≈" ของปีก่อนใช้ยอดสิ้นปีเพราะรายงานไม่มียอดต้นปีของปีก่อน</p>`;
    bench.forEach((r) => {
      const max = Math.max(r.y, r.py, r.benchmark) * 1.25;
      C.hbars(document.querySelector(`[data-bench="${r.id}"]`), [
        { label: `ปี ${yr}`, value: r.y, prev: r.py, valueText: fmtUnit(r.y, r.unit), tip: `<div class="t-title">${esc(r.label)}</div><div>ปี ${yr}: ${fmtUnit(r.y, r.unit)}</div><div>ปี ${pyr}: ${fmtUnit(r.py, r.unit)}</div><div>ค่าเฉลี่ย: ${fmtUnit(r.benchmark, r.unit)}</div>` }
      ], { max, ref: r.benchmark, compact: true });
    });
  }

  // ---------------- portfolio
  function renderPortfolio(c, A) {
    const f = state.port;
    const q = f.q.trim().toLowerCase();
    const match = (s) => !q || s.toLowerCase().indexOf(q) >= 0;
    const yr = c.report.year;
    const pyr = c.report.prevYear;
    const S = (k) => f.sections.has(k);
    const sections = [
      ["loans", "สินเชื่อ"], ["funding", "เงินรับฝากและเงินกู้ยืม"], ["placed", "เงินฝากสหกรณ์อื่น"], ["invest", "เงินลงทุน"], ["lines", "แหล่งเงินกู้และภาระผูกพัน"]
    ];
    const fundingIds = ["dep_m_sav", "dep_m_special", "dep_m_fixed", "dep_coop", "dep_assoc"].concat(BORROW_IDS);

    const loans = (c.loans || []).filter((l) => match(l.type) && (!f.problemOnly || l.problem));
    const funding = A.items.filter((i) => fundingIds.includes(i.id) && (i.y !== 0 || i.py !== 0))
      .filter((i) => match(i.label) && (!f.problemOnly || i.change < 0));
    const placed = (c.depositsPlaced || []).filter((d) => match(d.name + " " + d.kind) && (!f.problemOnly || d.y < d.py));
    const invest = (c.investments || []).filter((i) => match(i.name + " " + i.kind) && (!f.problemOnly || i.fair < i.cost));
    const lines = (c.creditLines || []).filter((l) => match(l.lender + " " + l.kind) && (!f.problemOnly || (l.pyBalance != null && l.balance > l.pyBalance)));
    const ln = c.loanNotes || {};

    let html = `
      <div class="section-head"><div><h2>สินเชื่อ เงินฝาก และแหล่งเงินทุน</h2><p>ยอด ณ วันสิ้นปีบัญชี ${esc(c.report.fiscalYearEnd)} เทียบปีก่อน</p></div></div>
      <div class="filters" role="group" aria-label="ตัวกรองพอร์ต">
        <div class="field"><span class="field-label">ส่วนที่แสดง</span>
          <div class="chips">${sections.map(([k, l]) => chip("port.sections", k, l, S(k))).join("")}</div></div>
        <label class="field grow"><span class="field-label">ค้นหาชื่อ</span>
          <input type="search" placeholder="เช่น ชุมนุม, สามัญ, ฉุกเฉิน" value="${esc(f.q)}" data-f="port.q"></label>
        <label class="field"><span class="field-label">เงื่อนไข</span>
          <span class="chips">${chip("port.problemOnly", "toggle", "เฉพาะที่เป็นความเสี่ยง (ลดลง / ขาดทุน / มีปัญหา / หนี้เพิ่ม)", f.problemOnly)}</span></label>
      </div>`;

    if (S("loans")) {
      const normal = loans.filter((l) => !l.problem);
      const granted = normal.filter((l) => l.contracts);
      const hasPersons = granted.some((l) => l.persons != null);
      const hasOutstanding = granted.some((l) => l.outstandingContracts != null);
      const notes = [];
      if (ln.rate) notes.push(`อัตราดอกเบี้ยเงินกู้: ${esc(ln.rate)}`);
      if (ln.nonAccrual) notes.push(`เงินให้กู้ที่ไม่ก่อให้เกิดรายได้ ${M(ln.nonAccrual.y)} (ปีก่อน ${M(ln.nonAccrual.py)})${ln.nonAccrual.note ? ` — ${esc(ln.nonAccrual.note)}` : ""}`);
      if (ln.allowance && ln.allowance.y != null) notes.push(`ค่าเผื่อหนี้สงสัยจะสูญ ${M(ln.allowance.y)}${ln.allowance.py != null ? ` (ปีก่อน ${M(ln.allowance.py)})` : ""}`);
      if (ln.moratorium) notes.push(`พักชำระหนี้: ${esc(ln.moratorium.note)}`);
      html += `<section class="section grid grid-2">
        <div class="card"><h3>เงินให้กู้คงเหลือตามประเภท</h3><p class="sub">ล้านบาท</p>
          ${C.legend([{ label: `สิ้นปี ${yr}`, color: "var(--series-1)" }, { label: `ต้นปี (สิ้นปี ${pyr})`, kind: "tick" }])}<div id="pf-loans"></div></div>
        <div class="card"><h3>การปล่อยกู้ระหว่างปี ${yr}</h3><p class="sub">จำนวนสัญญาที่อนุมัติและยอดเงิน</p>
          <div class="table-wrap"><table><thead><tr><th>ประเภท</th>${hasPersons ? '<th class="r">ราย</th>' : ""}<th class="r">สัญญาที่อนุมัติ</th><th class="r">จำนวนเงิน</th>${hasOutstanding ? '<th class="r">สัญญาคงเหลือ</th>' : ""}</tr></thead>
          <tbody>${granted.map((l) => `<tr><td>${esc(l.type)}</td>${hasPersons ? `<td class="r num">${cnt(l.persons)}</td>` : ""}<td class="r num">${cnt(l.contracts)}</td><td class="r num">${baht(l.granted)}</td>${hasOutstanding ? `<td class="r num">${cnt(l.outstandingContracts)}</td>` : ""}</tr>`).join("") || `<tr><td colspan="5" class="empty">–</td></tr>`}</tbody></table></div>
          ${notes.length ? `<ul class="note-list" style="margin-top:10px">${notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
        </div></section>
        <section class="section"><div class="table-wrap"><table>
          <thead><tr><th>ประเภทลูกหนี้</th><th class="r">ยอดต้นปี</th><th class="r">เพิ่มระหว่างปี</th><th class="r">ลดระหว่างปี</th><th class="r">คงเหลือสิ้นปี</th><th class="r">%</th><th class="r">สัดส่วน</th></tr></thead>
          <tbody>${loans.map((l) => `<tr><td>${esc(l.type)} ${l.problem ? '<span class="tag">ลูกหนี้มีปัญหา</span>' : ""}</td><td class="r num">${baht(l.begin)}</td><td class="r num">${baht(l.granted)}</td><td class="r num">${baht(l.repaid)}</td><td class="r num"><strong>${baht(l.end)}</strong></td><td class="r num">${spct(growth(l.end, l.begin))}</td><td class="r num">${pct((l.end / ln.total) * 100)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">ไม่มีรายการที่ตรงกับตัวกรอง</td></tr>`}</tbody>
        </table></div></section>`;
    }
    if (S("funding")) {
      html += `<section class="section"><div class="card"><h3>เงินรับฝากและเงินกู้ยืม</h3><p class="sub">แหล่งเงินทุนที่มีภาระดอกเบี้ย (ไม่รวมทุนของสหกรณ์) หน่วย: ล้านบาท</p>
        ${C.legend([{ label: `ปี ${yr}`, color: "var(--series-1)" }, { label: `ปี ${pyr}`, kind: "tick" }])}<div id="pf-funding"></div>
        ${c.interestExpenseSplit ? `<p class="small muted" style="margin-top:10px">ดอกเบี้ยจ่ายเงินรับฝาก: สมาชิก ${M(c.interestExpenseSplit.memberDeposits.y)} (ปีก่อน ${M(c.interestExpenseSplit.memberDeposits.py)}) · สหกรณ์อื่น ${M(c.interestExpenseSplit.coopDeposits.y)} (ปีก่อน ${M(c.interestExpenseSplit.coopDeposits.py)})</p>` : ""}
      </div></section>`;
    }
    if (S("placed")) {
      html += `<section class="section"><h3 style="margin-bottom:8px">เงินฝากสหกรณ์อื่น</h3><div class="table-wrap"><table>
        <thead><tr><th>สหกรณ์ผู้รับฝาก</th><th>ประเภท</th><th class="r">ปี ${yr}</th><th class="r">ปี ${pyr}</th><th class="r">เปลี่ยนแปลง</th><th class="r">%</th></tr></thead>
        <tbody>${placed.map((d) => `<tr><td>${esc(d.name)}</td><td><span class="tag">${esc(d.kind)}</span></td><td class="r num">${baht(d.y)}</td><td class="r num">${baht(d.py)}</td><td class="r num">${baht(d.y - d.py)}</td><td class="r num">${d.py ? spct(growth(d.y, d.py)) : d.y ? '<span class="tag">ใหม่</span>' : "–"}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">ไม่มีรายการที่ตรงกับตัวกรอง</td></tr>`}
        ${placed.length > 1 ? `<tr class="lvl-0"><td>รวม</td><td></td><td class="r num">${baht(sum(placed.map((d) => d.y)))}</td><td class="r num">${baht(sum(placed.map((d) => d.py)))}</td><td class="r num">${baht(sum(placed.map((d) => d.y - d.py)))}</td><td class="r num">${spct(growth(sum(placed.map((d) => d.y)), sum(placed.map((d) => d.py))))}</td></tr>` : ""}</tbody>
      </table></div></section>`;
    }
    if (S("invest")) {
      const marketOnly = invest.every((i) => i.fair === i.cost);
      html += `<section class="section"><h3 style="margin-bottom:8px">เงินลงทุน</h3>${marketOnly && invest.length ? '<p class="small muted" style="margin:0 0 8px">ทุกรายการเป็นหุ้นชุมนุมสหกรณ์ที่ไม่อยู่ในความต้องการของตลาด แสดงด้วยราคาทุน</p>' : ""}<div class="table-wrap"><table>
        <thead><tr><th>หลักทรัพย์</th><th>ประเภท</th><th class="r">ราคาทุน</th><th class="r">มูลค่า ${yr}</th><th class="r">กำไร(ขาดทุน)ที่ยังไม่เกิดขึ้น</th><th class="r">%</th><th class="r">มูลค่าปี ${pyr}</th></tr></thead>
        <tbody>${invest.map((i) => { const g = i.fair - i.cost; return `<tr><td>${esc(i.name)}</td><td><span class="tag">${esc(i.kind)} · ${esc(i.term)}</span></td><td class="r num">${baht(i.cost)}</td><td class="r num">${baht(i.fair)}</td><td class="r num ${g > 0 ? "pos" : g < 0 ? "neg" : ""}">${g === 0 ? "–" : baht(g)}</td><td class="r num">${g === 0 ? "–" : spct((g / i.cost) * 100)}</td><td class="r num">${baht(i.pyFair)}</td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">ไม่มีรายการที่ตรงกับตัวกรอง</td></tr>`}
        ${invest.length > 1 ? `<tr class="lvl-0"><td>รวม</td><td></td><td class="r num">${baht(sum(invest.map((i) => i.cost)))}</td><td class="r num">${baht(sum(invest.map((i) => i.fair)))}</td><td class="r num">${baht(sum(invest.map((i) => i.fair - i.cost)))}</td><td></td><td class="r num">${baht(sum(invest.map((i) => i.pyFair)))}</td></tr>` : ""}</tbody>
      </table></div></section>`;
    }
    if (S("lines")) {
      const hasPy = lines.some((l) => l.pyBalance != null);
      html += `<section class="section"><h3 style="margin-bottom:8px">แหล่งเงินกู้ วงเงิน และภาระผูกพัน</h3><div class="table-wrap"><table>
        <thead><tr><th>แหล่งเงิน</th><th>ประเภท</th><th class="r">วงเงิน</th><th>อัตราดอกเบี้ย</th><th class="r">คงเหลือ ${yr}</th>${hasPy ? `<th class="r">คงเหลือ ${pyr}</th>` : ""}<th class="r">ใช้วงเงิน</th></tr></thead>
        <tbody>${lines.map((l) => `<tr><td>${esc(l.lender)}</td><td><span class="tag">${esc(l.kind)}</span></td><td class="r num">${baht(l.limit)}</td><td>${esc(l.rate)}</td><td class="r num">${baht(l.balance)}</td>${hasPy ? `<td class="r num">${baht(l.pyBalance)}</td>` : ""}<td class="r num">${l.limit ? pct((l.balance / l.limit) * 100) : "–"}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">ไม่มีรายการที่ตรงกับตัวกรอง</td></tr>`}</tbody>
      </table></div></section>`;
    }
    if (!f.sections.size) html += `<div class="empty">เลือกอย่างน้อยหนึ่งส่วนเพื่อแสดงข้อมูล</div>`;
    main.innerHTML = html;

    if (S("loans") && document.getElementById("pf-loans")) {
      C.hbars(document.getElementById("pf-loans"), loans.filter((l) => !l.problem).map((l) => ({
        label: l.type, value: l.end, prev: l.begin, valueText: mb(l.end),
        tip: `<div class="t-title">${esc(l.type)}</div><div>สิ้นปี ${yr}: ${M(l.end)}</div><div>ต้นปี: ${M(l.begin)}</div><div>เปลี่ยนแปลง ${spct(growth(l.end, l.begin))}</div>`
      })));
    }
    if (S("funding") && document.getElementById("pf-funding")) {
      C.hbars(document.getElementById("pf-funding"), funding.map((i) => ({
        label: i.label.replace("เงินรับฝาก: ", ""), value: i.y, prev: i.py, valueText: mb(i.y),
        tip: `<div class="t-title">${esc(i.label)}</div><div>ปี ${yr}: ${M(i.y)}</div><div>ปี ${pyr}: ${M(i.py)}</div><div>เปลี่ยนแปลง ${spct(i.pct)}</div>`
      })).sort((a, b) => b.value - a.value));
    }
  }

  // ---------------- budget
  function budgetStatus(i) {
    if (i.budget === 0) return i.actual > 0 ? "unbudgeted" : "none";
    const p = (i.actual / i.budget) * 100;
    if (i.actual === 0) return "unused";
    if (p > 100.0001) return "over";
    if (p >= 90) return "ontrack";
    return "under";
  }
  const BUDGET_STATUS = {
    over: { label: "เกินงบ", cls: "neg" },
    ontrack: { label: "ใช้ 90–100%", cls: "" },
    under: { label: "ใช้ต่ำกว่า 90%", cls: "" },
    unused: { label: "ไม่ได้ใช้", cls: "muted" },
    unbudgeted: { label: "ไม่ได้ตั้งงบ", cls: "neg" },
    none: { label: "ตั้งงบปีหน้า", cls: "muted" }
  };

  function revenuePlanTable(c, A) {
    const plan = c.plan;
    if (!plan || !plan.revenueLines) return "";
    const yr = c.report.year;
    const cur = plan.current;
    const hasPlan = plan.revenueLines.some((l) => l.plan != null);
    const head = hasPlan
      ? `<th>รายการ</th><th class="r">ประมาณการ ${yr}</th><th class="r">ผลจริง</th><th class="r">%</th><th class="r">ประมาณการ ${yr + 1}</th>`
      : `<th>รายการ</th><th class="r">ผลจริง ${yr}</th><th class="r">ประมาณการ ${yr + 1}</th><th class="r">เปลี่ยนแปลง</th>`;
    const row = (name, p, a, n, cls) => hasPlan
      ? `<tr class="${cls || ""}"><td>${esc(name)}</td><td class="r num">${mb(p)}</td><td class="r num">${mb(a)}</td><td class="r num ${p ? (a >= p ? "pos" : "neg") : ""}">${p ? pct((a / p) * 100) : "–"}</td><td class="r num">${mb(n)}</td></tr>`
      : `<tr class="${cls || ""}"><td>${esc(name)}</td><td class="r num">${mb(a)}</td><td class="r num">${mb(n)}</td><td class="r num">${spct(growth(n, a))}</td></tr>`;
    const np = A.val("net_profit", "y");
    return `<div class="card"><h3>ประมาณการรายได้${hasPlan ? `: ปี ${yr} เทียบผลจริง และ` : ""} ปี ${yr + 1}</h3><p class="sub">หน่วย: ล้านบาท</p>
      <div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>
      ${plan.revenueLines.map((l) => row(l.name, l.plan, l.actual, l.next)).join("")}
      ${row("รวมรายได้", cur ? cur.revenuePlan : null, cur ? cur.revenue : A.revenue("y"), plan.next ? plan.next.revenue : null, "lvl-0")}
      ${row("กำไรสุทธิ", cur ? cur.profitPlan : null, cur ? cur.profit : np, plan.next ? plan.next.profit : null, "lvl-0")}
      </tbody></table></div></div>`;
  }

  function renderBudget(c, A) {
    const b = c.budget;
    if (!b) {
      main.innerHTML = `<div class="empty">รายงานนี้ไม่มีข้อมูลงบประมาณ</div>`;
      return;
    }
    const f = state.budget;
    const q = f.q.trim().toLowerCase();
    const catName = {};
    b.categories.forEach((x) => (catName[x.id] = x.name));
    if (f.cat !== "all" && !catName[f.cat]) f.cat = "all";
    const hasNext = b.items.some((i) => i.next != null);
    let rows = b.items.map((i) => Object.assign({}, i, { status: budgetStatus(i), variance: i.actual - i.budget, used: i.budget ? (i.actual / i.budget) * 100 : null }))
      .filter((i) => (f.cat === "all" || i.cat === f.cat) && (f.status === "all" || i.status === f.status) && (!q || i.name.toLowerCase().indexOf(q) >= 0));
    const sorters = {
      variance: (a, z) => z.variance - a.variance,
      used: (a, z) => (z.used == null ? Infinity : z.used) - (a.used == null ? Infinity : a.used),
      budget: (a, z) => z.budget - a.budget,
      order: () => 0
    };
    rows = rows.slice().sort(sorters[f.sort]);
    const counts = {};
    b.items.forEach((i) => {
      const s = budgetStatus(i);
      counts[s] = (counts[s] || 0) + 1;
    });
    if (f.status !== "all" && !counts[f.status]) f.status = "all";
    const used = (b.total.actual / b.total.budget) * 100;
    const yr = c.report.year;

    main.innerHTML = `
      <div class="section-head"><div><h2>การใช้จ่ายงบประมาณประจำปี ${yr}</h2><p>${esc(b.scope || "งบประมาณรายจ่าย")} ${M(b.total.budget)} · ใช้จริง ${M(b.total.actual)} (${pct(used)})</p></div></div>
      <section class="section grid grid-2">
        <div class="card"><h3>ร้อยละการใช้งบตามหมวด</h3><p class="sub">เส้นแนวตั้ง = 100% ของงบ · แถบสีส้ม = เกินงบ</p><div id="bg-cats"></div></div>
        ${revenuePlanTable(c, A)}
      </section>
      <div class="filters" role="group" aria-label="ตัวกรองงบประมาณ">
        <label class="field"><span class="field-label">หมวด</span>
          <select data-f="budget.cat">${option("all", "ทุกหมวด", f.cat === "all")}${b.categories.map((x) => option(x.id, x.name, f.cat === x.id)).join("")}</select></label>
        <div class="field"><span class="field-label">สถานะการใช้งบ</span>
          <div class="chips">${chip("budget.status", "all", `ทั้งหมด (${b.items.length})`, f.status === "all")}${Object.keys(BUDGET_STATUS).filter((k) => counts[k]).map((k) => chip("budget.status", k, `${BUDGET_STATUS[k].label} (${counts[k]})`, f.status === k)).join("")}</div></div>
        <label class="field"><span class="field-label">เรียงตาม</span>
          <select data-f="budget.sort">${option("variance", "ใช้เกินงบมาก → น้อย (บาท)", f.sort === "variance")}${option("used", "ร้อยละการใช้งบ มาก → น้อย", f.sort === "used")}${option("budget", "วงเงินงบประมาณ มาก → น้อย", f.sort === "budget")}${option("order", "ลำดับตามรายงาน", f.sort === "order")}</select></label>
        <label class="field grow"><span class="field-label">ค้นหารายการ</span>
          <input type="search" placeholder="เช่น โครงการ, ค่าเบี้ย" value="${esc(f.q)}" data-f="budget.q"></label>
        <span class="filter-summary">แสดง ${rows.length} จาก ${b.items.length} รายการ</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>รายการ</th><th>หมวด</th><th class="r">งบประมาณ</th><th class="r">จ่ายจริง</th><th class="r">คงเหลือ / (เกินงบ)</th><th class="r">% ใช้</th><th>สถานะ</th>${hasNext ? `<th class="r">งบปี ${yr + 1}</th>` : ""}</tr></thead>
        <tbody>${rows.length ? rows.map((i) => `<tr>
          <td>${esc(i.name)}</td><td><span class="tag">${esc(catName[i.cat].replace(/^\d+\.\s*/, ""))}</span></td>
          <td class="r num">${baht(i.budget)}</td><td class="r num">${baht(i.actual)}</td>
          <td class="r num ${i.variance > 0 ? "neg" : ""}">${baht(i.budget - i.actual)}</td>
          <td class="r num">${i.used == null ? "–" : pct(i.used)}</td>
          <td><span class="${BUDGET_STATUS[i.status] ? BUDGET_STATUS[i.status].cls : ""}">${BUDGET_STATUS[i.status] ? BUDGET_STATUS[i.status].label : "–"}</span></td>
          ${hasNext ? `<td class="r num">${baht(i.next)}</td>` : ""}</tr>`).join("") : `<tr><td colspan="8" class="empty">ไม่มีรายการที่ตรงกับตัวกรอง</td></tr>`}</tbody>
      </table></div>`;

    C.hbars(document.getElementById("bg-cats"), b.categories.filter((x) => x.budget > 0 || x.actual > 0).map((x) => {
      const p = x.budget ? (x.actual / x.budget) * 100 : null;
      return {
        label: x.name.replace(/^\d+\.\s*/, ""), value: p == null ? 120 : p, over: p == null || p > 100, valueText: p == null ? "ไม่ได้ตั้งงบ" : pct(p),
        tip: `<div class="t-title">${esc(x.name)}</div><div>งบประมาณ ${M(x.budget)}</div><div>ใช้จริง ${M(x.actual)}</div><div>${x.actual > x.budget ? "เกินงบ" : "คงเหลือ"} ${M(Math.abs(x.budget - x.actual))}</div>`
      };
    }), { max: 120, ref: 100 });
  }

  // ---------------- trends
  function trendYears(c) {
    const hist = c.history || [];
    const mh = (c.members && c.members.history) || [];
    return [...new Set(hist.map((h) => h.year).concat(mh.map((m) => m.year)))].sort();
  }

  function renderTrends(c) {
    const hist = c.history || [];
    const mh = (c.members && c.members.history) || [];
    const years = trendYears(c);
    if (!years.length) {
      main.innerHTML = `<div class="empty">รายงานนี้ไม่มีข้อมูลย้อนหลัง</div>`;
      return;
    }
    const f = state.trend;
    if (f.from == null || !years.includes(f.from)) f.from = years[0];
    if (f.to == null || !years.includes(f.to)) f.to = years[years.length - 1];
    if (f.from > f.to) [f.from, f.to] = [f.to, f.from];
    const inR = (y) => y >= f.from && y <= f.to;
    const H = hist.filter((h) => inR(h.year));
    const MH = mh.filter((m) => inR(m.year));
    const hasFlow = MH.length > 0 && MH.every((m) => m.joined != null && m.left != null);
    const presets = [3, 5].filter((n) => years.length > n);
    main.innerHTML = `
      <div class="section-head"><div><h2>แนวโน้มหลายปี</h2><p>การจัดสรรกำไรสุทธิย้อนหลังและจำนวนสมาชิกตามที่รายงานแสดง (${years.length} ปี: ${years[0]}–${years[years.length - 1]})</p></div></div>
      <div class="filters" role="group" aria-label="ช่วงปี">
        <label class="field"><span class="field-label">ตั้งแต่ปี</span><select data-f="trend.from" data-num>${years.map((y) => option(y, y, y === f.from)).join("")}</select></label>
        <label class="field"><span class="field-label">ถึงปี</span><select data-f="trend.to" data-num>${years.map((y) => option(y, y, y === f.to)).join("")}</select></label>
        ${presets.length ? `<div class="field"><span class="field-label">ช่วงด่วน</span><div class="chips">${presets.map((n) => chip("trend.preset", String(n), `${n} ปีล่าสุด`, false)).join("")}${chip("trend.preset", "all", "ทั้งหมด", f.from === years[0] && f.to === years[years.length - 1])}</div></div>` : ""}
      </div>
      <section class="section grid grid-2">
        <div class="card"><h3>กำไรสุทธิ</h3><p class="sub">ล้านบาท</p><div class="chart" id="tr-profit"></div></div>
        <div class="card"><h3>อัตราเงินปันผลและเงินเฉลี่ยคืน</h3><p class="sub">ร้อยละ</p>
          ${C.legend([{ label: "เงินปันผล (% ของหุ้น)", color: "var(--series-1)", kind: "line" }, { label: "เงินเฉลี่ยคืน (% ของดอกเบี้ยจ่าย)", color: "var(--series-2)", kind: "line" }])}
          <div class="chart" id="tr-rates"></div></div>
      </section>
      <section class="section grid grid-2">
        <div class="card"><h3>จำนวนสมาชิก ณ สิ้นปี</h3><p class="sub">คน</p><div class="chart" id="tr-members"></div></div>
        <div class="card"><h3>สมาชิกเข้าใหม่และออก</h3><p class="sub">คนต่อปี</p>
          ${hasFlow ? C.legend([{ label: "เข้าใหม่", color: "var(--series-1)", kind: "line" }, { label: "ออก", color: "var(--series-2)", kind: "line" }]) : ""}
          <div class="chart" id="tr-flow"></div></div>
      </section>
      <section class="section"><h3 style="margin-bottom:8px">การจัดสรรกำไรสุทธิ</h3><div class="table-wrap"><table>
        <thead><tr><th>ปี</th><th class="r">กำไรสุทธิ</th><th class="r">เติบโต</th><th class="r">ทุนสำรอง</th><th class="r">% ของกำไร</th><th class="r">เงินปันผล</th><th class="r">อัตรา</th><th class="r">เงินเฉลี่ยคืน</th><th class="r">อัตรา</th><th class="r">โบนัสกรรมการและเจ้าหน้าที่</th></tr></thead>
        <tbody>${H.slice().reverse().map((h) => { const p = hist[hist.indexOf(h) - 1]; return `<tr><td>${h.year}</td><td class="r num">${baht(h.profit)}</td><td class="r num">${p ? spct(growth(h.profit, p.profit)) : "–"}</td><td class="r num">${baht(h.reserve)}</td><td class="r num">${h.reserve == null ? "–" : pct((h.reserve / h.profit) * 100)}</td><td class="r num">${baht(h.dividend)}</td><td class="r num">${pct(h.dividendRate)}</td><td class="r num">${baht(h.refund)}</td><td class="r num">${esc(refundText(h))}</td><td class="r num">${baht(h.bonus)}</td></tr>`; }).join("") || `<tr><td colspan="10" class="empty">ไม่มีข้อมูลในช่วงปีที่เลือก</td></tr>`}</tbody>
      </table></div></section>`;

    if (H.length) {
      C.columns(document.getElementById("tr-profit"), H.map((h) => ({ x: h.year, y: h.profit / 1e6, tip: `<div class="t-title">ปี ${h.year}</div><div>กำไรสุทธิ ${M(h.profit)}</div>` })), { fmtAxis: (t) => nf0.format(t), fmtValue: (t) => nf2.format(t), label: "กำไรสุทธิรายปี" });
      C.lines(document.getElementById("tr-rates"), [
        { name: "เงินปันผล", color: "var(--series-1)", points: H.map((h) => ({ x: h.year, y: h.dividendRate })) },
        { name: "เงินเฉลี่ยคืน", color: "var(--series-2)", points: H.map((h) => ({ x: h.year, y: h.refundRate })) }
      ].filter((s) => s.points.every((p) => p.y != null)), { fmtAxis: (t) => nf0.format(t) + "%", fmtValue: (t) => nf2.format(t) + "%", label: "อัตราเงินปันผลและเงินเฉลี่ยคืน" });
    } else {
      document.getElementById("tr-profit").innerHTML = document.getElementById("tr-rates").innerHTML = `<div class="empty">ไม่มีข้อมูลในช่วงปีที่เลือก</div>`;
    }
    if (MH.length) {
      const minM = Math.min(...MH.map((m) => m.end));
      const maxM = Math.max(...MH.map((m) => m.end));
      C.lines(document.getElementById("tr-members"), [{ name: "สมาชิก", color: "var(--series-1)", points: MH.map((m) => ({ x: m.year, y: m.end })) }],
        { fmtAxis: (t) => nf0.format(t), fmtValue: (t) => nf0.format(t), yMin: Math.max(0, minM - Math.max(50, (maxM - minM) * 0.1)), label: "จำนวนสมาชิก" });
    } else {
      document.getElementById("tr-members").innerHTML = `<div class="empty">ไม่มีข้อมูลสมาชิกในช่วงปีที่เลือก</div>`;
    }
    if (hasFlow) {
      C.lines(document.getElementById("tr-flow"), [
        { name: "เข้าใหม่", color: "var(--series-1)", points: MH.map((m) => ({ x: m.year, y: m.joined })) },
        { name: "ออก", color: "var(--series-2)", points: MH.map((m) => ({ x: m.year, y: m.left })) }
      ], { fmtAxis: (t) => nf0.format(t), fmtValue: (t) => nf0.format(t), label: "สมาชิกเข้าใหม่และออก" });
    } else {
      document.getElementById("tr-flow").innerHTML = `<div class="empty">รายงานไม่ได้แสดงจำนวนสมาชิกเข้าใหม่และออกรายปี</div>`;
    }
  }

  // ---------------- litigation
  const LEGAL_STATUS = { ongoing: "ยังไม่สิ้นสุด", closed: "สิ้นสุดแล้ว", unknown: "ไม่ทราบสถานะ" };
  function renderLegal(c) {
    const L = c.litigation;
    if (!L) {
      main.innerHTML = `<div class="empty">ยังไม่ได้ค้นหาข้อมูลคดีความของสหกรณ์นี้</div>`;
      return;
    }
    const f = state.legal;
    const all = L.cases || [];
    const roles = [...new Set(all.map((x) => x.role))];
    if (f.role !== "all" && !roles.includes(f.role)) f.role = "all";
    const q = f.q.trim().toLowerCase();
    const rows = all.filter((x) => (f.status === "all" || x.status === f.status) && (f.role === "all" || x.role === f.role) &&
      (!q || [x.title, x.summary, x.type, x.counterparty || ""].join(" ").toLowerCase().indexOf(q) >= 0));
    const cnt0 = (st) => all.filter((x) => x.status === st).length;
    const src = (s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`;
    main.innerHTML = `
      <div class="section-head"><div><h2>คดีความและการร้องเรียน</h2><p>รวบรวมจากรายงานประจำปี (หัวข้อการถูกร้องทุกข์ ดำเนินคดี ร้องเรียน และลงโทษ ตามกฎกระทรวงฯ พ.ศ. 2564 ข้อ 14(2) และหมายเหตุประกอบงบการเงิน) และการค้นหาข่าวบนอินเทอร์เน็ต · ตรวจสอบเมื่อ ${esc(L.checked || "–")}</p></div></div>
      <section class="section kpis">
        <div class="card kpi"><div class="label">คดีที่พบ</div><div class="value">${all.length}</div></div>
        <div class="card kpi"><div class="label">ยังไม่สิ้นสุด</div><div class="value">${cnt0("ongoing")}</div></div>
        <div class="card kpi"><div class="label">สิ้นสุดแล้ว</div><div class="value">${cnt0("closed")}</div></div>
        <div class="card kpi"><div class="label">สหกรณ์เป็นฝ่ายถูกฟ้อง/ถูกกล่าวหา</div><div class="value">${all.filter((x) => x.role === "จำเลย" || x.role === "ผู้ถูกกล่าวหา").length}</div></div>
      </section>
      <section class="section grid grid-2">
        <div class="card"><h3>สิ่งที่รายงานประจำปีเปิดเผย</h3><p class="sub">${esc(c.report.title)}</p><p>${esc(L.disclosure || "–")}</p></div>
        <div class="card"><h3>ผลการค้นหาบนอินเทอร์เน็ต</h3><p class="sub">ข่าว เว็บไซต์หน่วยงานราชการ และฐานข้อมูลคำพิพากษา</p><p>${esc(L.searchNote || "–")}</p></div>
      </section>
      <div class="filters" role="group" aria-label="ตัวกรองคดี">
        <div class="field"><span class="field-label">สถานะ</span><div class="chips">${chip("legal.status", "all", `ทั้งหมด (${all.length})`, f.status === "all")}${Object.keys(LEGAL_STATUS).filter((k) => cnt0(k)).map((k) => chip("legal.status", k, `${LEGAL_STATUS[k]} (${cnt0(k)})`, f.status === k)).join("")}</div></div>
        <label class="field"><span class="field-label">บทบาทของสหกรณ์</span><select data-f="legal.role">${option("all", "ทุกบทบาท", f.role === "all")}${roles.map((r) => option(r, r, f.role === r)).join("")}</select></label>
        <label class="field grow"><span class="field-label">ค้นหา</span><input type="search" placeholder="เช่น สลาก, ล้มละลาย, อดีตเจ้าหน้าที่" value="${esc(f.q)}" data-f="legal.q"></label>
        <span class="filter-summary">แสดง ${rows.length} จาก ${all.length} เรื่อง</span>
      </div>
      <div class="findings">${rows.map((x) => `<article class="finding sev-${x.status === "ongoing" ? (x.role === "จำเลย" || x.role === "ผู้ถูกกล่าวหา" ? "risk" : "watch") : "info"}">
        <div class="rail" aria-hidden="true"></div>
        <div>
          <div class="finding-head"><span class="tag">${esc(LEGAL_STATUS[x.status] || x.status)}</span><span class="tag">สหกรณ์เป็น${esc(x.role)}</span><span class="tag">${esc(x.type)}</span>${x.period ? `<span class="tag">${esc(x.period)}</span>` : ""}</div>
          <h3>${esc(x.title)}</h3>
          <p>${esc(x.summary)}</p>
          ${x.amount ? `<p class="small">มูลค่าที่เกี่ยวข้อง: <strong>${baht(x.amount)} บาท</strong></p>` : ""}
          <p class="small muted">ที่มา: ${(x.sources || []).map(src).join(" · ")}</p>
        </div></article>`).join("") || `<div class="empty">${all.length ? "ไม่มีเรื่องที่ตรงกับตัวกรอง" : "ไม่พบคดีความหรือการร้องเรียนจากแหล่งข้อมูลที่ตรวจสอบ"}</div>`}</div>
      <p class="small muted">ข้อมูลส่วนนี้สรุปจากเอกสารและข่าวที่เปิดเผยต่อสาธารณะ ไม่ได้ระบุชื่อบุคคลธรรมดาที่เป็นคู่ความ และอาจไม่ครบถ้วนหรือไม่เป็นปัจจุบัน ควรตรวจสอบกับสหกรณ์หรือศาลก่อนนำไปใช้</p>`;
  }

  // ---------------- findings
  function renderFindings(c, A) {
    const f = state.find;
    const q = f.q.trim().toLowerCase();
    const topics = [...new Set(A.findings.map((x) => x.topic))];
    if (f.topic !== "all" && !topics.includes(f.topic)) f.topic = "all";
    const counts = {};
    A.findings.forEach((x) => (counts[x.sev] = (counts[x.sev] || 0) + 1));
    const rows = A.findings.filter((x) => f.sev.has(x.sev) && (f.topic === "all" || x.topic === f.topic) && (!q || (x.title + " " + x.detail + " " + x.topic).toLowerCase().indexOf(q) >= 0));
    main.innerHTML = `
      <div class="section-head"><div><h2>ข้อค้นพบจากการวิเคราะห์</h2><p>สร้างจากกฎการวิเคราะห์ที่ใช้กับงบการเงิน อัตราส่วน งบประมาณ และข้อมูลย้อนหลัง รวมกับข้อสังเกตจากการอ่านรายงาน</p></div></div>
      <div class="filters" role="group" aria-label="ตัวกรองข้อค้นพบ">
        <div class="field"><span class="field-label">ระดับ</span>
          <div class="chips">${Object.keys(SEV).map((k) => chip("find.sev", k, `<span class="sev-${k}" style="display:inline-flex"><span class="sev-icon" aria-hidden="true">${SEV[k].icon}</span></span>${SEV[k].label} (${counts[k] || 0})`, f.sev.has(k))).join("")}</div></div>
        <label class="field"><span class="field-label">หัวข้อ</span>
          <select data-f="find.topic">${option("all", "ทุกหัวข้อ", f.topic === "all")}${topics.map((t) => option(t, t, f.topic === t)).join("")}</select></label>
        <label class="field grow"><span class="field-label">ค้นหา</span>
          <input type="search" placeholder="เช่น สภาพคล่อง, ดอกเบี้ย" value="${esc(f.q)}" data-f="find.q"></label>
        <span class="filter-summary">แสดง ${rows.length} จาก ${A.findings.length} ข้อ</span>
      </div>
      <div class="findings">${rows.map(findingHTML).join("") || '<div class="empty">ไม่มีข้อค้นพบที่ตรงกับตัวกรอง</div>'}</div>`;
  }

  // ---------------- home dashboard (all cooperatives)
  const ratioOf = (A, id) => A.ratios.find((r) => r.id === id) || null;
  const ratioValue = (A, id) => {
    const r = ratioOf(A, id);
    return r && isFinite(r.y) ? r.y : -Infinity;
  };
  const sevCount = (A, s) => A.findings.filter((x) => x.sev === s).length;
  const latest = (c) => (c.history && c.history.length ? c.history[c.history.length - 1] : null);

  const HOME_SORTS = {
    assets: { label: "สินทรัพย์รวม มาก → น้อย", key: ({ A }) => A.val("total_assets", "y") },
    profit: { label: "กำไรสุทธิ มาก → น้อย", key: ({ A }) => A.val("net_profit", "y") },
    growth: { label: "การเติบโตของกำไร มาก → น้อย", key: ({ A }) => growth(A.val("net_profit", "y"), A.val("net_profit", "py")) },
    roe: { label: "ROE มาก → น้อย", key: ({ A }) => ratioValue(A, "roe") },
    risk: { label: "ประเด็นความเสี่ยง มาก → น้อย", key: ({ A }) => sevCount(A, "risk") * 100 + sevCount(A, "watch") },
    name: { label: "ชื่อสหกรณ์ (ก–ฮ)", key: null }
  };

  function homeRows() {
    const f = state.home;
    const q = f.q.trim().toLowerCase();
    const rows = coops.map((c, i) => ({ c, i, A: analysisOf(i) })).filter(({ c, A }) =>
      (!q || [c.name, c.shortName, c.province || "", c.nameEn || ""].join(" ").toLowerCase().indexOf(q) >= 0) &&
      (!f.riskOnly || sevCount(A, "risk") > 0) && (f.year === "all" || String(c.report.year) === f.year));
    const key = HOME_SORTS[f.sort].key;
    return rows.sort(key ? (a, b) => key(b) - key(a) : (a, b) => a.c.shortName.localeCompare(b.c.shortName, "th"));
  }

  function worstSev(list) {
    return list.reduce((w, s) => (s && (!w || SEV[s].rank < SEV[w].rank) ? s : w), null);
  }

  function coopCard({ c, i, A }) {
    const np = A.val("net_profit", "y");
    const h = latest(c);
    const roe = ratioOf(A, "roe");
    const cs = ratioOf(A, "coopdep_share");
    const top = A.findings.find((x) => x.sev === "risk") || A.findings.find((x) => x.sev === "watch");
    const stat = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
    return `<article class="card coop-card">
      <div class="coop-card-head">
        <div><h3><a href="${coopHash(i)}">${esc(c.shortName)}</a></h3><div class="sub">${esc(c.name)}</div></div>
        ${c.province ? `<span class="tag">จ.${esc(c.province)}</span>` : ""}
      </div>
      <div class="coop-card-hero">
        <div class="muted small">กำไรสุทธิปีบัญชี ${c.report.year} (สิ้นสุด ${esc(c.report.fiscalYearEnd)})</div>
        <div class="value">${mb(np)} <small>ล้านบาท</small></div>
        <div>${delta(growth(np, A.val("net_profit", "py")), true)} <span class="muted small">เทียบปี ${c.report.prevYear}</span></div>
      </div>
      <dl class="mini-stats">
        ${stat("สินทรัพย์รวม", `${mb(A.val("total_assets", "y"))} ล้านบาท`)}
        ${stat("เงินให้กู้แก่สมาชิก", `${mb(A.val("st_loans", "y") + A.val("lt_loans", "y"))} ล้านบาท`)}
        ${stat("สมาชิก", `${cnt(c.members && c.members.total)} คน`)}
        ${stat("ROE", roe ? `${pct(roe.y)}${roe.benchmark != null ? ` <span class="small ${roe.vsBench === "better" ? "pos" : "neg"}">(เฉลี่ย ${pct(roe.benchmark)})</span>` : ""}` : "–")}
        ${stat("ปันผล / เฉลี่ยคืน", h ? `${pct(h.dividendRate)} / ${esc(refundText(h))}` : "–")}
        ${stat("เงินฝากจากสหกรณ์อื่น", cs ? `${pct(cs.y)} ของเงินรับฝาก` : "–")}
      </dl>
      <div class="sev-counts">${["risk", "watch", "good"].map((s) => `<span class="sev sev-${s}"><span class="sev-icon" aria-hidden="true">${SEV[s].icon}</span>${SEV[s].label} ${sevCount(A, s)}</span>`).join("")}</div>
      ${top ? `<p class="top-issue"><span class="muted small">ประเด็นสำคัญที่สุด</span><br>${esc(top.title)}</p>` : ""}
      <div class="card-actions">
        <button type="button" class="btn btn-primary" data-open-coop="${i}">ดูการวิเคราะห์ →</button>
        <button type="button" class="btn" data-open-coop="${i}" data-open-tab="findings">ข้อค้นพบ (${A.findings.length})</button>
        <button type="button" class="btn" data-export-visit="${i}" title="ดาวน์โหลดแบบบันทึกการเข้าร่วมประชุมใหญ่ที่กรอกผลวิเคราะห์แล้ว">แบบบันทึก .docx</button>
      </div>
    </article>`;
  }

  function renderHome() {
    const f = state.home;
    const rows = homeRows();
    const tot = (fn) => sum(rows.map(fn));
    const npY = tot(({ A }) => A.val("net_profit", "y"));
    const npP = tot(({ A }) => A.val("net_profit", "py"));
    const years = [...new Set(rows.map(({ c }) => c.report.year))].sort();
    const kpis = [
      { label: "สหกรณ์", value: cnt(rows.length), unit: rows.length === coops.length ? "แห่ง" : `แห่ง (จาก ${coops.length})` },
      { label: "สินทรัพย์รวม", value: mb(tot(({ A }) => A.val("total_assets", "y"))), unit: "ล้านบาท" },
      { label: "เงินให้กู้รวม", value: mb(tot(({ A }) => A.val("st_loans", "y") + A.val("lt_loans", "y"))), unit: "ล้านบาท" },
      { label: "กำไรสุทธิรวม", value: mb(npY), unit: "ล้านบาท", d: delta(growth(npY, npP), true) },
      { label: "สมาชิกรวม", value: cnt(tot(({ c }) => (c.members ? c.members.total : 0))), unit: "คน" },
      { label: "คดีที่ยังไม่สิ้นสุด", value: cnt(tot(({ c }) => ((c.litigation && c.litigation.cases) || []).filter((x) => x.status === "ongoing").length)), unit: "เรื่อง" },
      { label: "ความเสี่ยง / เฝ้าระวัง", value: `${tot(({ A }) => sevCount(A, "risk"))} / ${tot(({ A }) => sevCount(A, "watch"))}`, unit: "ประเด็น" }
    ];

    // Issue matrix: the worst severity per topic per cooperative.
    const topics = [];
    rows.forEach(({ A }) => A.findings.forEach((x) => { if (!topics.includes(x.topic)) topics.push(x.topic); }));
    const flagged = (cells) => cells.filter((s) => s === "risk" || s === "watch").length;
    const matrix = topics
      .map((t) => {
        const cells = rows.map(({ A }) => worstSev(A.findings.filter((x) => x.topic === t).map((x) => x.sev)));
        return { t, cells, rank: Math.min(...cells.filter(Boolean).map((s) => SEV[s].rank)) };
      })
      .filter((m) => !f.issuesOnly || m.rank <= SEV.watch.rank)
      .sort((a, b) => a.rank - b.rank || flagged(b.cells) - flagged(a.cells));

    // Ratios that have a national benchmark, one small chart each.
    const benchIds = [];
    rows.forEach(({ A }) => A.ratios.forEach((r) => { if (r.benchmark != null && !benchIds.includes(r.id)) benchIds.push(r.id); }));

    // Comparison table.
    const ids = [];
    const meta = {};
    rows.forEach(({ A }) => A.ratios.forEach((r) => {
      if (!meta[r.id]) {
        meta[r.id] = r;
        ids.push(r.id);
      }
    }));
    const cats = RATIO_CATS.filter((cat) => ids.some((id) => meta[id].cat === cat));
    if (f.cat !== "all" && !cats.includes(f.cat)) f.cat = "all";
    const ratioIds = ids.filter((id) => (f.cat === "all" || meta[id].cat === f.cat) && (!f.benchOnly || meta[id].benchmark != null));
    const head = rows.map(({ c }) => `<th class="r">${esc(c.shortName)}<br><span class="muted small">ปี ${c.report.year}</span></th>`).join("");
    const keyRows = [
      ["สินทรัพย์รวม (ล้านบาท)", ({ A }) => mb(A.val("total_assets", "y"))],
      ["เงินให้กู้แก่สมาชิก (ล้านบาท)", ({ A }) => mb(A.val("st_loans", "y") + A.val("lt_loans", "y"))],
      ["เงินรับฝาก (ล้านบาท)", ({ A }) => mb(A.val("deposits", "y"))],
      ["เงินกู้ยืม (ล้านบาท)", ({ A }) => mb(A.sumIds(BORROW_IDS, "y"))],
      ["ทุนเรือนหุ้น (ล้านบาท)", ({ A }) => mb(A.val("shares", "y"))],
      ["ทุนของสหกรณ์ (ล้านบาท)", ({ A }) => mb(A.val("total_equity", "y"))],
      ["กำไรสุทธิ (ล้านบาท)", ({ A }) => mb(A.val("net_profit", "y"))],
      ["กำไรสุทธิเปลี่ยนแปลง", ({ A }) => spct(growth(A.val("net_profit", "y"), A.val("net_profit", "py")))],
      ["สมาชิก (คน)", ({ c }) => cnt(c.members && c.members.total)],
      ["อัตราเงินปันผล", ({ c }) => (latest(c) ? pct(latest(c).dividendRate) : "–")],
      ["อัตราเงินเฉลี่ยคืน", ({ c }) => esc(refundText(latest(c)))]
    ];
    const ratioCell = (r, list) => {
      if (!r) return `<td class="r muted">–</td>`;
      const vals = list.filter(Boolean).map((x) => x.y).filter((v) => v != null && isFinite(v));
      const best = r.better && vals.length > 1 && r.y === (r.better === "higher" ? Math.max(...vals) : Math.min(...vals));
      const vb = r.vsBench ? `<div class="small ${r.vsBench === "better" ? "pos" : "neg"}">${r.vsBench === "better" ? "ดีกว่าค่าเฉลี่ย" : "ด้อยกว่าค่าเฉลี่ย"}</div>` : "";
      return `<td class="r num">${best ? `<span class="tag">อันดับ 1</span> <strong>${fmtUnit(r.y, r.unit)}</strong>` : fmtUnit(r.y, r.unit)}${vb}</td>`;
    };

    const filters = `
      <div class="filters" role="group" aria-label="ตัวกรองสหกรณ์">
        <label class="field grow"><span class="field-label">ค้นหาสหกรณ์หรือจังหวัด</span>
          <input type="search" placeholder="เช่น หนองบัวลำภู, อำนาจเจริญ" value="${esc(f.q)}" data-f="home.q"></label>
        <label class="field"><span class="field-label">ปีบัญชีของรายงาน</span>
          <select data-f="home.year">${option("all", "ทุกปี", f.year === "all")}${[...new Set(coops.map((c) => c.report.year))].sort().reverse().map((y) => option(String(y), `ปีบัญชี ${y}`, f.year === String(y))).join("")}</select></label>
        <label class="field"><span class="field-label">เรียงตาม</span>
          <select data-f="home.sort">${Object.keys(HOME_SORTS).map((k) => option(k, HOME_SORTS[k].label, f.sort === k)).join("")}</select></label>
        <div class="field"><span class="field-label">เงื่อนไข</span>
          <div class="chips">${chip("home.riskOnly", "toggle", "เฉพาะสหกรณ์ที่มีประเด็นความเสี่ยง", f.riskOnly)}</div></div>
        <span class="filter-summary">แสดง ${rows.length} จาก ${coops.length} สหกรณ์</span>
      </div>`;

    if (!rows.length) {
      main.innerHTML = `
        <div class="section-head"><div><h2>ภาพรวมทุกสหกรณ์</h2></div></div>
        ${filters}
        <div class="empty">ไม่มีสหกรณ์ที่ตรงกับตัวกรอง</div>`;
      return;
    }

    main.innerHTML = `
      <div class="section-head"><div><h2>ภาพรวมทุกสหกรณ์</h2><p>สรุปจากรายงานประจำปีล่าสุดของแต่ละสหกรณ์ (ปีบัญชี ${years.join(", ")}) · เลือกสหกรณ์เพื่อดูการวิเคราะห์ฉบับเต็ม</p></div></div>
      ${filters}

      <section class="section kpis">
        ${kpis.map((k) => `<div class="card kpi"><div class="label">${esc(k.label)}${k.unit ? ` <span class="muted">(${esc(k.unit)})</span>` : ""}</div><div class="value">${k.value}</div>${k.d ? `<div>${k.d}</div>` : ""}</div>`).join("")}
      </section>

      <section class="section">
        <div class="section-head"><div><h2>เลือกสหกรณ์</h2><p>ตัวเลขหลักและประเด็นสำคัญที่สุดของแต่ละแห่ง</p></div></div>
        <div class="coop-cards">${rows.map(coopCard).join("")}</div>
      </section>

      ${benchIds.length ? `<section class="section">
        <div class="section-head"><div><h2>อัตราส่วนสำคัญเทียบค่าเฉลี่ยสหกรณ์ออมทรัพย์</h2><p>${esc((BENCH[rows[0].c.type] || {}).note || "")}</p></div></div>
        ${C.legend([{ label: "ดีกว่าค่าเฉลี่ย", color: "var(--series-1)" }, { label: "ด้อยกว่าค่าเฉลี่ย", color: "var(--series-2)" }, { label: "ค่าเฉลี่ย", kind: "ref" }])}
        <div class="grid grid-3">${benchIds.map((id) => {
          const r0 = rows.map(({ A }) => ratioOf(A, id)).find(Boolean);
          return `<div class="card"><h3>${esc(r0.label)}</h3><p class="sub">ค่าเฉลี่ย ${fmtUnit(r0.benchmark, r0.unit)} · ${r0.better === "higher" ? "ยิ่งสูงยิ่งดี" : "ยิ่งต่ำยิ่งดี"}</p><div data-home-bench="${id}"></div></div>`;
        }).join("")}</div>
      </section>` : ""}

      <section class="section">
        <div class="section-head"><div><h2>ประเด็นจากการวิเคราะห์</h2><p>ระดับที่รุนแรงที่สุดของแต่ละหัวข้อ · กดที่ช่องเพื่อเปิดข้อค้นพบของหัวข้อนั้น</p></div>
          <div class="chips">${chip("home.issuesOnly", "toggle", "เฉพาะหัวข้อที่มีความเสี่ยงหรือเฝ้าระวัง", f.issuesOnly)}</div></div>
        <div class="table-wrap"><table class="matrix">
          <thead><tr><th>หัวข้อ</th>${head}</tr></thead>
          <tbody>${matrix.length ? matrix.map((m) => `<tr><td>${esc(m.t)}</td>${m.cells.map((s, k) => {
            if (!s) return `<td class="r"><span class="muted">–</span></td>`;
            const titles = rows[k].A.findings.filter((x) => x.topic === m.t).map((x) => x.title).join(" · ");
            return `<td class="r"><button type="button" class="sev sev-${s} sev-btn" title="${esc(titles)}" data-matrix-coop="${rows[k].i}" data-matrix-topic="${esc(m.t)}"><span class="sev-icon" aria-hidden="true">${SEV[s].icon}</span>${SEV[s].label}</button></td>`;
          }).join("")}</tr>`).join("") : `<tr><td colspan="${rows.length + 1}" class="empty">ไม่มีหัวข้อที่ตรงกับตัวกรอง</td></tr>`}</tbody>
        </table></div>
      </section>

      <section class="section">
        <div class="section-head"><div><h2>เปรียบเทียบตัวเลขสำคัญและอัตราส่วน</h2><p>"อันดับ 1" = ดีที่สุดในกลุ่มตามทิศทางที่ดีของอัตราส่วน</p></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>รายการ</th>${head}</tr></thead>
          <tbody>${keyRows.map(([label, fn]) => `<tr><td>${esc(label)}</td>${rows.map((x) => `<td class="r num">${fn(x)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
      </section>
      <div class="filters" role="group" aria-label="ตัวกรองอัตราส่วน">
        <label class="field"><span class="field-label">หมวดอัตราส่วน</span>
          <select data-f="home.cat">${option("all", "ทุกหมวด", f.cat === "all")}${cats.map((cat) => option(cat, cat, f.cat === cat)).join("")}</select></label>
        <div class="field"><span class="field-label">เงื่อนไข</span><div class="chips">${chip("home.benchOnly", "toggle", "เฉพาะอัตราส่วนที่มีค่าเฉลี่ย", f.benchOnly)}</div></div>
        <span class="filter-summary">แสดง ${ratioIds.length} จาก ${ids.length} อัตราส่วน</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>อัตราส่วน</th><th>หมวด</th>${head}<th class="r">ค่าเฉลี่ย</th></tr></thead>
        <tbody>${ratioIds.length ? ratioIds.map((id) => {
          const list = rows.map(({ A }) => ratioOf(A, id));
          return `<tr><td>${esc(meta[id].label)}</td><td><span class="tag">${esc(meta[id].cat)}</span></td>${list.map((r) => ratioCell(r, list)).join("")}<td class="r num">${meta[id].benchmark == null ? "–" : fmtUnit(meta[id].benchmark, meta[id].unit)}</td></tr>`;
        }).join("") : `<tr><td colspan="${rows.length + 3}" class="empty">ไม่มีอัตราส่วนที่ตรงกับตัวกรอง</td></tr>`}</tbody>
      </table></div>
      <p class="small muted">ปีบัญชีและวิธีจัดกลุ่มรายการในงบของแต่ละสหกรณ์อาจต่างกัน อัตราส่วนที่สหกรณ์รายงานเองใช้ค่าตามรายงาน ส่วนอื่นคำนวณด้วยสูตรเดียวกันจากงบการเงิน</p>`;

    benchIds.forEach((id) => {
      const list = rows.map(({ c, A }) => ({ c, r: ratioOf(A, id) })).filter((x) => x.r && isFinite(x.r.y));
      const r0 = list[0].r;
      const max = Math.max(r0.benchmark, ...list.map((x) => x.r.y)) * 1.25;
      C.hbars(main.querySelector(`[data-home-bench="${id}"]`), list.map(({ c, r }) => ({
        label: c.province || c.shortName,
        value: r.y,
        over: r.vsBench === "worse",
        valueText: `${fmtUnit(r.y, r.unit)}${r.vsBench === "worse" ? " !" : ""}`,
        tip: `<div class="t-title">${esc(c.shortName)}</div><div>${esc(r.label)}: ${fmtUnit(r.y, r.unit)}</div><div>ค่าเฉลี่ย: ${fmtUnit(r.benchmark, r.unit)}</div><div>${r.vsBench === "better" ? "ดีกว่าค่าเฉลี่ย" : "ด้อยกว่าค่าเฉลี่ย"}</div>`
      })), { max, ref: r0.benchmark, labelWidth: 96 });
    });
  }

  // ------------------------------------------------------------ shell
  const RENDER = { overview: renderOverview, statements: renderStatements, ratios: renderRatios, portfolio: renderPortfolio, budget: renderBudget, trends: renderTrends, legal: renderLegal, findings: renderFindings };
  const analyses = [];

  function analysisOf(i) {
    if (!analyses[i]) analyses[i] = analyze(coops[i]);
    return analyses[i];
  }

  function coopHash(i, tab) {
    return `#/${coops[i].id}/${tab || "overview"}`;
  }

  function renderTabs(A) {
    document.getElementById("tabs").innerHTML = TABS.map((t) => {
      const count = t.id === "findings" ? `<span class="count">${A.findings.length}</span>` : "";
      return `<button type="button" class="tab" role="tab" id="tab-${t.id}" aria-selected="${t.id === state.tab}" aria-controls="main" data-tab="${t.id}">${t.label}${count}</button>`;
    }).join("");
  }

  function render(keepFocus) {
    if (!coops.length) {
      main.innerHTML = `<div class="empty">ยังไม่มีข้อมูลสหกรณ์ — เพิ่มไฟล์ใน data/ แล้วอ้างอิงใน index.html</div>`;
      return;
    }
    const active = keepFocus ? document.activeElement : null;
    const activeKey = active && active.dataset ? active.dataset.f : null;
    const caret = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    const home = state.view === "home";
    document.body.classList.toggle("is-home", home);
    if (home) {
      document.getElementById("coop-sub").textContent = `ภาพรวม ${coops.length} สหกรณ์ · รายงานประจำปีล่าสุด`;
      document.title = "ภาพรวมสหกรณ์ · วิเคราะห์รายงานประจำปี";
      document.getElementById("tabs").innerHTML = "";
      renderHome();
      renderFooter(coops);
    } else {
      const c = coops[state.coop];
      const A = analysisOf(state.coop);
      document.getElementById("coop-sub").textContent = `${c.shortName} · รายงานประจำปี ${c.report.year}`;
      document.title = `${c.shortName} · วิเคราะห์รายงานปี ${c.report.year}`;
      document.getElementById("coop-select").value = String(state.coop);
      renderTabs(A);
      RENDER[state.tab](c, A);
      renderFooter([c]);
    }
    if (activeKey) {
      const el = main.querySelector(`[data-f="${activeKey}"]`);
      if (el) {
        el.focus();
        if (caret != null && el.setSelectionRange) {
          try { el.setSelectionRange(caret, caret); } catch (e) { /* not a text input */ }
        }
      }
    }
  }

  function renderFooter(list) {
    document.getElementById("footer").innerHTML = list.map((c) => `
      <p>ที่มา: <a href="${esc(c.report.sourcePage)}" target="_blank" rel="noopener">${esc(c.report.title)} — ${esc(c.name)}</a> (${c.report.pages} หน้า${c.report.uploaded ? `, อัปโหลด ${esc(c.report.uploaded)}` : ""}) ${esc(c.report.extractionNote || "")} และตรวจยอดรวมทุกหมวดกับงบการเงินแล้ว เลขหน้าในตารางอ้างอิงเลขหน้าที่พิมพ์ในรายงาน</p>`).join("") + `
      <p>ผลการวิเคราะห์นี้จัดทำเพื่อประกอบการพิจารณาเบื้องต้น ไม่ใช่ความเห็นของผู้สอบบัญชีหรือคำแนะนำการลงทุน</p>`;
  }

  function getByPath(path) {
    const [grp, key] = path.split(".");
    return state[grp][key];
  }

  function setByPath(path, value) {
    const [grp, key] = path.split(".");
    state[grp][key] = value;
  }

  // Routes: "#/" = dashboard, "#/<coop id>/<tab>" = one cooperative's analysis.
  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const idx = parts.length ? coops.findIndex((c) => c.id === parts[0]) : -1;
    if (idx < 0) return { view: "home" };
    return { view: "coop", coop: idx, tab: RENDER[parts[1]] ? parts[1] : "overview" };
  }

  function applyRoute() {
    const r = parseRoute();
    state.view = r.view;
    if (r.view === "coop") {
      if (r.coop !== state.coop) {
        state.coop = r.coop;
        state.trend.from = state.trend.to = null;
      }
      state.tab = r.tab;
    }
    render();
    window.scrollTo({ top: 0 });
  }

  function navigate(hash) {
    if (location.hash === hash) applyRoute();
    else location.hash = hash;
  }

  function go(tab) {
    if (RENDER[tab]) navigate(coopHash(state.coop, tab));
  }

  // events
  document.getElementById("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) go(b.dataset.tab);
  });

  // แบบบันทึกการเข้าร่วมประชุมใหญ่ (.docx) — see assets/visit_form.js
  const FMT = { M, pct, spct, cnt, growth, refundText };
  function exportVisit(i, btn) {
    if (!window.VisitForm) return;
    const label = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "กำลังสร้างไฟล์…"; }
    window.VisitForm.download(coops[i], analysisOf(i), FMT)
      .catch((err) => alert(`สร้างแบบบันทึกไม่สำเร็จ: ${err.message}`))
      .finally(() => { if (btn) { btn.disabled = false; btn.textContent = label; } });
  }
  window.CoopApp = { coops, analysisOf, FMT };

  document.getElementById("export-visit").addEventListener("click", (e) => exportVisit(state.coop, e.currentTarget));

  document.addEventListener("click", (e) => {
    const exp = e.target.closest("[data-export-visit]");
    if (exp) return exportVisit(Number(exp.dataset.exportVisit), exp);
    const open = e.target.closest("[data-open-coop]");
    if (open) return navigate(coopHash(Number(open.dataset.openCoop), open.dataset.openTab));
    const mx = e.target.closest("[data-matrix-coop]");
    if (mx) {
      state.find.topic = mx.dataset.matrixTopic;
      state.find.sev = new Set(Object.keys(SEV));
      state.find.q = "";
      return navigate(coopHash(Number(mx.dataset.matrixCoop), "findings"));
    }
    const g = e.target.closest("[data-goto]");
    if (g) return go(g.dataset.goto);
    const reset = e.target.closest("[data-sort-reset]");
    if (reset) {
      state.st.sort = "order";
      return drawStatementTable(coops[state.coop], analysisOf(state.coop));
    }
    const th = e.target.closest("th[data-sort]");
    if (th) {
      const key = th.dataset.sort;
      if (state.st.sort === key) state.st.sortDir *= -1;
      else {
        state.st.sort = key;
        state.st.sortDir = -1;
      }
      return drawStatementTable(coops[state.coop], analysisOf(state.coop));
    }
    const ch = e.target.closest("[data-chip]");
    if (ch) {
      const path = ch.dataset.chip;
      const value = ch.dataset.value;
      if (path === "port.sections" || path === "find.sev") {
        const set = path === "port.sections" ? state.port.sections : state.find.sev;
        if (set.has(value)) set.delete(value);
        else set.add(value);
      } else if (path === "trend.preset") {
        const years = trendYears(coops[state.coop]);
        state.trend.to = years[years.length - 1];
        state.trend.from = value === "all" ? years[0] : years[Math.max(0, years.length - Number(value))];
      } else if (value === "toggle") {
        setByPath(path, !getByPath(path));
      } else {
        setByPath(path, value);
      }
      render();
    }
  });

  main.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.dataset.f) return;
    if (t.type === "range") {
      setByPath(t.dataset.f, Number(t.value));
      const out = t.parentElement.querySelector("output");
      if (out) out.textContent = `≥ ${t.value}%`;
      return drawStatementTable(coops[state.coop], analysisOf(state.coop));
    }
    if (t.type === "search") {
      setByPath(t.dataset.f, t.value);
      if (t.dataset.f === "st.q") return drawStatementTable(coops[state.coop], analysisOf(state.coop));
      render(true);
    }
  });

  main.addEventListener("change", (e) => {
    const t = e.target;
    if (!t.dataset.f || t.tagName !== "SELECT") return;
    setByPath(t.dataset.f, "num" in t.dataset ? Number(t.value) : t.value);
    render(true);
  });

  const select = document.getElementById("coop-select");
  select.innerHTML = coops.map((c, i) => option(i, `${c.shortName} (ปี ${c.report.year})`, i === state.coop)).join("");
  select.addEventListener("change", () => navigate(coopHash(Number(select.value), state.tab)));

  // theme toggle: auto → light → dark
  const themeBtn = document.getElementById("theme-toggle");
  const THEMES = ["auto", "light", "dark"];
  const THEME_LABEL = { auto: "ธีม: อัตโนมัติ", light: "ธีม: สว่าง", dark: "ธีม: มืด" };
  function applyTheme(t) {
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    themeBtn.textContent = THEME_LABEL[t];
  }
  let theme = "auto";
  try { theme = localStorage.getItem("coop-theme") || "auto"; } catch (e) { /* storage unavailable */ }
  applyTheme(theme);
  themeBtn.addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    applyTheme(theme);
    try { localStorage.setItem("coop-theme", theme); } catch (e) { /* storage unavailable */ }
    render();
  });

  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => render(), 150);
  });

  window.addEventListener("hashchange", applyRoute);
  applyRoute();
})();
