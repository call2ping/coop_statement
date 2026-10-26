"""Build data/<id>-<year>.js from a compact JSON spec of a cooperative's core statements.

The spec holds statement lines as [id, label, y, py] (y = latest year, py = prior year).
Every group must add up to its reported total; the script stops on any mismatch so
transcription errors are caught before the site uses the numbers.

Usage:
    python scripts/make_coop.py specs/udcoop-2569.json
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def line(st, sec, group, level, page, row):
    lid, label, y, py = row
    return {"id": lid, "st": st, "sec": sec, "group": group, "label": label, "y": y, "py": py, "level": level, "page": page}


def check(name, rows, total, errors):
    for k, idx in (("y", 2), ("py", 3)):
        s = round(sum(r[idx] for r in rows), 2)
        if abs(s - total[idx - 2]) > 0.011:
            errors.append(f"{name} {k}: lines {s:,.2f} != total {total[idx - 2]:,.2f}")


def build(spec):
    errors = []
    bs, is_ = spec["bs"], spec["is"]
    pb, pi = spec.get("bsPage"), spec.get("isPage")
    items = []

    def section(st, sec, group, rows, total_id, total_label, total, page, detail=None):
        check(group, rows, total, errors)
        for r in rows:
            items.append(line(st, sec, group, 1, page, r))
            if detail and r[0] in detail:
                d = detail[r[0]]
                check(f"{r[0]} detail", d, r[2:4], errors)
                items.extend(line(st, sec, group, 2, page, x) for x in d)
        items.append(line(st, sec, group, 0, page, [total_id, total_label] + total))

    det = bs.get("detail", {})
    section("bs", "สินทรัพย์", "สินทรัพย์หมุนเวียน", bs["ca"], "total_ca", "รวมสินทรัพย์หมุนเวียน", bs["total_ca"], pb, det)
    section("bs", "สินทรัพย์", "สินทรัพย์ไม่หมุนเวียน", bs["nca"], "total_nca", "รวมสินทรัพย์ไม่หมุนเวียน", bs["total_nca"], pb, det)
    check("assets", [["", "", bs["total_ca"][0], bs["total_ca"][1]], ["", "", bs["total_nca"][0], bs["total_nca"][1]]], bs["total_assets"], errors)
    items.append(line("bs", "สินทรัพย์", "รวม", 0, pb, ["total_assets", "รวมสินทรัพย์"] + bs["total_assets"]))
    section("bs", "หนี้สิน", "หนี้สินหมุนเวียน", bs["cl"], "total_cl", "รวมหนี้สินหมุนเวียน", bs["total_cl"], pb, det)
    if bs.get("ncl"):
        section("bs", "หนี้สิน", "หนี้สินไม่หมุนเวียน", bs["ncl"], "total_ncl", "รวมหนี้สินไม่หมุนเวียน", bs["total_ncl"], pb, det)
        check("liabilities", [["", "", bs["total_cl"][0], bs["total_cl"][1]], ["", "", bs["total_ncl"][0], bs["total_ncl"][1]]], bs["total_liab"], errors)
    items.append(line("bs", "หนี้สิน", "รวม", 0, pb, ["total_liab", "รวมหนี้สิน"] + bs["total_liab"]))
    section("bs", "ทุนของสหกรณ์", "ทุนของสหกรณ์", bs["eq"], "total_equity", "รวมทุนของสหกรณ์", bs["total_equity"], pb, det)
    for k in (0, 1):
        if abs(bs["total_liab"][k] + bs["total_equity"][k] - bs["total_assets"][k]) > 0.011:
            errors.append(f"L+E != A ({'y' if k == 0 else 'py'})")

    idet = is_.get("detail", {})
    section("is", "รายได้", "รายได้ดอกเบี้ยและผลตอบแทน", is_["inc"], "total_int_income", "รวมรายได้ดอกเบี้ยและผลตอบแทนจากการลงทุน", is_["total_int_income"], pi, idet)
    section("is", "ค่าใช้จ่าย", "ค่าใช้จ่ายดอกเบี้ย", is_["ie"], "total_int_exp", "รวมค่าใช้จ่ายดอกเบี้ย", is_["total_int_exp"], pi, idet)
    bd = is_.get("bad_debt") or [0, 0]
    if is_.get("bad_debt") is not None:
        items.append(line("is", "ค่าใช้จ่าย", "หนี้สงสัยจะสูญ", 1, pi, ["bad_debt", is_.get("bad_debt_label", "หนี้สงสัยจะสูญ (กลับรายการ)")] + bd))
    nii = [round(is_["total_int_income"][k] - is_["total_int_exp"][k] - bd[k], 2) for k in (0, 1)]
    for k in (0, 1):
        if abs(nii[k] - is_["net_int_income"][k]) > 0.011:
            errors.append(f"net interest income {nii[k]:,.2f} != {is_['net_int_income'][k]:,.2f}")
    items.append(line("is", "กำไร", "กำไร", 0, pi, ["net_int_income", "รายได้ดอกเบี้ยและผลตอบแทนจากเงินลงทุนสุทธิ"] + is_["net_int_income"]))
    oi = is_.get("oi") or [["oi_all", "รายได้อื่น", is_["total_other_income"][0], is_["total_other_income"][1]]]
    check("other income", oi, is_["total_other_income"], errors)
    items.extend(line("is", "รายได้", "รายได้อื่น", 2, pi, r) for r in oi)
    items.append(line("is", "รายได้", "รายได้อื่น", 0, pi, ["total_other_income", "รวมรายได้อื่น"] + is_["total_other_income"]))
    check("opex", is_["opex"], is_["total_opex"], errors)
    for r in is_["opex"]:
        items.append(line("is", "ค่าใช้จ่าย", r[1], 1, pi, r))
        if r[0] in idet:
            check(f"{r[0]} detail", idet[r[0]], r[2:4], errors)
            items.extend(line("is", "ค่าใช้จ่าย", r[1], 2, pi, x) for x in idet[r[0]])
    items.append(line("is", "ค่าใช้จ่าย", "รวม", 0, pi, ["total_opex", "รวมค่าใช้จ่ายในการดำเนินงาน"] + is_["total_opex"]))
    for k in (0, 1):
        np_ = round(is_["net_int_income"][k] + is_["total_other_income"][k] - is_["total_opex"][k], 2)
        if abs(np_ - is_["net_profit"][k]) > 0.011:
            errors.append(f"net profit {np_:,.2f} != {is_['net_profit'][k]:,.2f}")
        bp = next((r for r in bs["eq"] if r[0] == "bs_profit"), None)
        if bp and abs(bp[2 + k] - is_["net_profit"][k]) > 0.011:
            errors.append("balance-sheet profit != income-statement profit")
    items.append(line("is", "กำไร", "กำไร", 0, pi, ["net_profit", "กำไร(ขาดทุน)สุทธิ"] + is_["net_profit"]))
    if errors:
        raise SystemExit("RECONCILIATION FAILED:\n  " + "\n  ".join(errors))

    out = {k: v for k, v in spec.items() if k not in ("bs", "is", "bsPage", "isPage")}
    out["type"] = out.get("type", "สหกรณ์ออมทรัพย์")
    out["items"] = items
    return out


def main():
    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    coop = build(spec)
    target = ROOT / "data" / f"{coop['id']}-{coop['report']['year']}.js"
    body = json.dumps(coop, ensure_ascii=False, indent=1)
    target.write_text(
        f"// {coop['name']} — {coop['report']['title']}\n"
        f"// Generated by scripts/make_coop.py from {Path(sys.argv[1]).as_posix()} (core statements only).\n"
        f"registerCoop({body});\n",
        encoding="utf-8",
    )
    print("wrote", target.relative_to(ROOT), f"({len(coop['items'])} lines, reconciled)")


if __name__ == "__main__":
    main()
