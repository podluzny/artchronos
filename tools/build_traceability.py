#!/usr/bin/env python3
"""Строит validation/traceability-matrix.md и validation/acceptance-matrix.md из SDD-документов
и проверяет целостность ссылок (висячие ID, непокрытые требования).

Это инструмент сопровождения документации (T-029), а не код продукта.

Запуск:  python3 tools/build_traceability.py          — перегенерировать матрицы
         python3 tools/build_traceability.py --check  — только проверка (ненулевой код при ошибках)
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ID_RE = re.compile(r"\b(FR|NFR|BR|SC|SPEC|AC|INV|T)-[A-Z0-9]+(?:-[A-Z0-9]+)*(?:\.\d+)?\b")
FULL_ID = re.compile(r"(?:FR|NFR|SC|SPEC|AC)-[A-Z0-9]+-\d{3}(?:\.\d+)?|(?:BR|INV)-\d{3}")
# Упоминаются в тексте намеренно, но не определены: следующий свободный номер BR.
ALLOWED_UNDEFINED = {"BR-047"}
PREFIXED = re.compile(r"((?:FR|NFR|SC|SPEC|AC)-[A-Z0-9]+-)(\d{3})(\.\d+)?")


def expand_ids(text):
    """Извлекает ID с поддержкой сокращений: 'SPEC-ITEM-001, -002', 'FR-EDU-001…003',
    'SPEC-ITEM-001 … -005', 'AC-AUTH-003.1 … AC-AUTH-003.8', 'BR-001…BR-005'."""
    out = []
    last_prefix = None
    # нормализуем многоточия
    text = text.replace("...", "…")
    tokens = re.split(r"(\s*…\s*|,\s*|\s+)", text)
    pending_range = False
    for tok in tokens:
        if tok is None or not tok.strip(" ,"):
            if tok and "…" in tok:
                pending_range = True
            continue
        if "…" in tok:
            pending_range = True
            continue
        tok = tok.strip("`*()[];:|")
        m = PREFIXED.fullmatch(tok)
        short = re.fullmatch(r"-(\d{3})", tok) or re.fullmatch(r"(\d{3})", tok)
        brm = re.fullmatch(r"(BR|T|INV)-(\d{3})", tok)
        acshort = re.fullmatch(r"\.(\d+)", tok)
        new = None
        if m:
            last_prefix = m.group(1)
            new = (m.group(1), int(m.group(2)), m.group(3))
        elif brm:
            last_prefix = brm.group(1) + "-"
            new = (last_prefix, int(brm.group(2)), None)
        elif short and last_prefix:
            new = (last_prefix, int(short.group(1)), None)
        elif acshort and out:
            p, n, _ = out[-1]
            new = (p, n, "." + acshort.group(1))
        if new is None:
            continue
        if pending_range and out:
            p0, n0, s0 = out[-1]
            if s0 and new[2] and p0 == new[0] and n0 == new[1]:
                a, b = int(s0[1:]), int(new[2][1:])
                for k in range(a + 1, b):
                    out.append((p0, n0, f".{k}"))
            elif p0 == new[0] and not s0 and not new[2]:
                for k in range(n0 + 1, new[1]):
                    out.append((p0, k, None))
        pending_range = False
        out.append(new)
    return [f"{p}{n:03d}{s or ''}" for p, n, s in out]


def table_rows(path, first_col_prefix):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("| " + first_col_prefix) or line.startswith("| **" + first_col_prefix):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            rows.append(cells)
    return rows


def load():
    data = {}
    # FR
    fr = {}
    for c in table_rows(ROOT / "docs/requirements.md", "FR-"):
        fid = c[0]
        fr[fid] = dict(text=c[1], prio=c[2], br=expand_ids(c[3]), sc=expand_ids(c[4]), spec=expand_ids(c[5]))
    data["FR"] = fr
    # BR
    br = {}
    for c in table_rows(ROOT / "docs/business-rules.md", "BR-"):
        br[c[0]] = dict(text=c[1])
    data["BR"] = br
    # NFR
    nfr = {}
    for c in table_rows(ROOT / "docs/non-functional-requirements.md", "NFR-"):
        nfr[c[0]] = dict(text=c[1], verify=c[2] if len(c) > 2 else "")
    data["NFR"] = nfr
    # INV
    inv = {}
    for c in table_rows(ROOT / "docs/domain-model.md", "INV-"):
        inv[c[0]] = dict(text=c[1])
    data["INV"] = inv
    # SC
    sc = {}
    for c in table_rows(ROOT / "scenarios/scenario-registry.md", "SC-"):
        sid = c[0].strip("*")
        sc[sid] = dict(title=c[1].strip("*"), block=c[3], spec=expand_ids(c[5]))
    data["SC"] = sc
    # SPEC
    specs = {}
    for p in sorted((ROOT / "specs").rglob("SPEC-*.md")):
        txt = p.read_text(encoding="utf-8")
        title = txt.splitlines()[0]
        m = re.match(r"# (SPEC-[A-Z]+-\d{3}): (.*)", title)
        sid, name = m.group(1), m.group(2)
        hdr = {}
        for line in txt.splitlines():
            mm = re.match(r"\| (Блок|Requirements|Scenarios|Business rules) \| (.*) \|$", line)
            if mm:
                hdr[mm.group(1)] = mm.group(2)
        acs = {}
        for line in txt.splitlines():
            ma = re.match(r"\| (AC-[A-Z]+-\d{3}\.\d+) \| (.*?) \| (.*?) \|$", line)
            if ma:
                acs[ma.group(1)] = dict(text=ma.group(2), kind=ma.group(3))
        specs[sid] = dict(
            name=name,
            path=p.relative_to(ROOT).as_posix(),
            block=hdr.get("Блок", ""),
            req=expand_ids(hdr.get("Requirements", "")),
            sc=expand_ids(hdr.get("Scenarios", "")),
            br=expand_ids(hdr.get("Business rules", "")),
            ac=acs,
        )
    data["SPEC"] = specs
    # Tasks
    tasks = {}
    for c in table_rows(ROOT / "tasks/task-registry.md", "T-"):
        row = " | ".join(c)
        ids = expand_ids(row)
        tasks[c[0]] = dict(title=c[1], refs=ids, status=c[-1])
    data["T"] = tasks
    return data


def check(d):
    errors, warnings = [], []
    known = set(d["FR"]) | set(d["BR"]) | set(d["NFR"]) | set(d["SC"]) | set(d["SPEC"]) | set(d["T"]) | set(d["INV"])
    all_ac = {a for s in d["SPEC"].values() for a in s["ac"]}
    known |= all_ac
    # висячие ссылки во всех md
    for p in sorted(ROOT.rglob("*.md")):
        if "validation" in p.parts:
            continue
        txt = p.read_text(encoding="utf-8")
        for m in ID_RE.finditer(txt):
            i = m.group(0)
            # проверяем только полные идентификаторы; префиксы категорий (FR-AUTH, NFR-SEC) — не ссылки
            if not FULL_ID.fullmatch(i) or i in ALLOWED_UNDEFINED:
                continue
            if i not in known:
                errors.append(f"{p.relative_to(ROOT)}: неизвестный ID {i}")
    # FR → SPEC/SC существуют и согласованы
    for fid, f in d["FR"].items():
        if not f["spec"] and f["prio"].startswith("M"):
            errors.append(f"{fid}: нет спецификации")
        for s in f["spec"]:
            if s in d["SPEC"] and fid not in d["SPEC"][s]["req"]:
                warnings.append(f"{fid} ссылается на {s}, но {s} не перечисляет {fid} в Requirements")
    for sid, s in d["SPEC"].items():
        for r in s["req"]:
            if r.startswith("FR-") and r in d["FR"] and sid not in d["FR"][r]["spec"]:
                warnings.append(f"{sid} перечисляет {r}, но {r} не ссылается на {sid}")
        if not s["ac"]:
            errors.append(f"{sid}: нет acceptance criteria")
        if not any(sid in t["refs"] for t in d["T"].values()):
            errors.append(f"{sid}: нет задачи реализации")
    # BR покрыты спецификациями
    for bid in d["BR"]:
        if not any(bid in s["br"] for s in d["SPEC"].values()):
            errors.append(f"{bid}: не упомянуто ни в одной спецификации")
    for sid in d["SC"]:
        if sid != "SC-E2E-001" and not any(sid in s["sc"] for s in d["SPEC"].values()):
            warnings.append(f"{sid}: не указан ни в одной спецификации (Scenarios)")
    return sorted(set(errors)), sorted(set(warnings))


def tasks_for(d, spec_id):
    return sorted(t for t, v in d["T"].items() if spec_id in v["refs"] and int(t[2:]) > 30)


def at(ac):
    return "AT-" + ac[3:]


def build_traceability(d):
    L = []
    L.append("# Traceability Matrix\n")
    L.append("| Поле | Значение |\n|---|---|\n| Задача | T-029 |\n| Генерируется | `python3 tools/build_traceability.py` — не редактировать вручную |\n")
    L.append("Путь трассировки: `BR → FR → SC → SPEC → T → AT`. AT-идентификатор соответствует acceptance criterion спецификации один к одному (`AC-ITEM-001.3` ↔ `AT-ITEM-001.3`).\n")
    # BR
    L.append("## 1. Business rules\n")
    L.append("| BR | Правило (кратко) | FR | SC | SPEC | T | AT |\n|---|---|---|---|---|---|---|")
    for bid, b in d["BR"].items():
        frs = [f for f, v in d["FR"].items() if bid in v["br"]]
        specs = [s for s, v in d["SPEC"].items() if bid in v["br"]]
        scs = sorted({x for f in frs for x in d["FR"][f]["sc"]} | {x for s in specs for x in d["SPEC"][s]["sc"] if x.startswith("SC-")})
        ts = sorted({t for s in specs for t in tasks_for(d, s)})
        ats = [at(a) for s in specs for a in d["SPEC"][s]["ac"]]
        short = re.sub(r"`", "", b["text"])[:90] + ("…" if len(b["text"]) > 90 else "")
        L.append(f"| {bid} | {short} | {', '.join(frs) or '—'} | {', '.join(scs[:6]) or '—'}{' …' if len(scs) > 6 else ''} | {', '.join(specs) or '—'} | {', '.join(ts) or '—'} | {len(ats)} AT ({', '.join(sorted({a.rsplit('.',1)[0] + '.*' for a in ats})[:4])}{' …' if len({a.rsplit('.',1)[0] for a in ats}) > 4 else ''}) |")
    # FR
    L.append("\n## 2. Functional requirements\n")
    L.append("| FR | P | SC | SPEC | T | AT |\n|---|---|---|---|---|---|")
    for fid, f in d["FR"].items():
        ts = sorted({t for s in f["spec"] for t in tasks_for(d, s)})
        ats = sorted({at(a).rsplit(".", 1)[0] + ".*" for s in f["spec"] if s in d["SPEC"] for a in d["SPEC"][s]["ac"]})
        L.append(f"| {fid} | {f['prio']} | {', '.join(f['sc']) or '—'} | {', '.join(f['spec']) or '—'} | {', '.join(ts) or '—'} | {', '.join(ats) or '—'} |")
    # NFR
    L.append("\n## 3. Non-functional requirements\n")
    L.append("| NFR | Верификация | SPEC / ADR | T |\n|---|---|---|---|")
    for nid, n in d["NFR"].items():
        specs = [s for s, v in d["SPEC"].items() if nid in v["req"]]
        ts = sorted(t for t, v in d["T"].items() if nid in v["refs"] or any(s in v["refs"] for s in specs) and int(t[2:]) > 30)
        L.append(f"| {nid} | {n['verify']} | {', '.join(specs) or '—'} | {', '.join(ts) or '—'} |")
    # SPEC
    L.append("\n## 4. Specifications\n")
    L.append("| SPEC | Название | Блок | FR/NFR | SC | BR | T | AC |\n|---|---|---|---|---|---|---|---|")
    for sid, s in d["SPEC"].items():
        L.append(f"| [{sid}](../{s['path']}) | {s['name']} | {s['block']} | {', '.join(s['req'])} | {', '.join(s['sc']) or '—'} | {', '.join(s['br']) or '—'} | {', '.join(tasks_for(d, sid)) or '—'} | {len(s['ac'])} |")
    return "\n".join(L) + "\n"


AT_RE = re.compile(r"\bAT-E2E-001(?:-API)?|\bAT-PERM-(?:MATRIX|\d{3})|\bAT-[A-Z0-9]+-\d{3}(?:\.\d+)?[a-z]?")


def load_results():
    """Статусы AT из результатов тестов: validation/test-results.json (vitest --reporter=json)
    и validation/e2e-results.json (playwright, опционально). Имя теста должно содержать AT-идентификатор."""
    status = {}

    def mark(name, ok):
        for m in AT_RE.findall(name):
            key = re.sub(r"[a-z]$", "", m)
            if status.get(key) == "fail":
                continue
            status[key] = "pass" if ok else "fail"

    import json
    # vitest: основной прогон и нагрузочные тесты (npm run test:perf)
    for name in ("validation/test-results.json", "validation/perf-results.json"):
        p = ROOT / name
        if not p.exists():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        for f in data.get("testResults", []):
            for t in f.get("assertionResults", []):
                mark(" ".join(t.get("ancestorTitles", []) + [t.get("title", "")]), t.get("status") == "passed")
    p = ROOT / "validation/e2e-results.json"
    if p.exists():

        def walk(suite, prefix):
            title = " ".join(x for x in [prefix, suite.get("title", "")] if x)
            for spec in suite.get("specs", []):
                mark(f"{title} {spec.get('title', '')}", bool(spec.get("ok")))
            for child in suite.get("suites", []):
                walk(child, title)

        for suite in json.loads(p.read_text(encoding="utf-8")).get("suites", []):
            walk(suite, "")
    return status


STATUS_ICON = {"pass": "✓", "fail": "🔴", None: "⏳"}


def build_acceptance(d, errors):
    results = load_results()
    L = []
    L.append("# Acceptance Matrix\n")
    L.append("| Поле | Значение |\n|---|---|\n| Задача | T-029 |\n| Генерируется | `python3 tools/build_traceability.py` — статусы ⏳ обновляются по результатам CI |\n")
    L.append("Статусы: ⏳ planned · 🔴 failing · ✓ passing. Источник статусов — `validation/test-results.json` (`npm run test:report`).\n")
    blocks = defaultdict(list)
    for sid, s in d["SPEC"].items():
        for b in re.findall(r"BL-\d{2}", s["block"])[:1]:
            blocks[b].append(sid)
    total_req = set()
    covered = set()
    for b in sorted(blocks):
        L.append(f"## {b}\n")
        L.append("### Покрытие требований\n")
        L.append("| Requirement | Scenario | Test | Status |\n|---|---|---|---|")
        reqs = []
        for sid in blocks[b]:
            s = d["SPEC"][sid]
            for r in s["req"] + s["br"]:
                if r not in reqs:
                    reqs.append(r)
        for r in reqs:
            specs = [x for x in blocks[b] if r in d["SPEC"][x]["req"] + d["SPEC"][x]["br"]]
            scs = []
            if r in d["FR"]:
                scs = d["FR"][r]["sc"]
            if not scs:
                scs = sorted({x for sp in specs for x in d["SPEC"][sp]["sc"] if x.startswith("SC-")})[:3]
            tests = sorted({at(a).rsplit(".", 1)[0] + ".*" for sp in specs for a in d["SPEC"][sp]["ac"]})
            total_req.add(r)
            if tests:
                covered.add(r)
            ats_r = [at(a) for sp in specs for a in d["SPEC"][sp]["ac"]]
            st = [results.get(x) for x in ats_r]
            icon = "✓" if st and all(x == "pass" for x in st) else ("🔴" if "fail" in st else ("◐" if "pass" in st else "⏳"))
            L.append(f"| {r} | {', '.join(scs) or '—'} | {', '.join(tests)} | {icon} |")
        L.append("\n### Acceptance tests\n")
        L.append("| AT | Критерий | Тип | SPEC | Status |\n|---|---|---|---|---|")
        for sid in blocks[b]:
            for a, v in d["SPEC"][sid]["ac"].items():
                L.append(f"| {at(a)} | {v['text']} | {v['kind']} | {sid} | {STATUS_ICON[results.get(at(a))]} |")
        L.append("")
    L.append("## Сквозные acceptance-наборы\n")
    L.append("| AT | Состав | Источник | Status |\n|---|---|---|---|")
    def st(k):
        return STATUS_ICON[results.get(k)]
    L.append(f"| AT-PERM-001 | Студент не может читать чужой private draft | AT-ITEM-004.1, AT-ITEM-002.2 | {st('AT-PERM-001')} |")
    L.append(f"| AT-PERM-002 | Студент не может approve | AT-ITEM-004.5, AT-REVIEW-003.9 | {st('AT-PERM-002')} |")
    L.append(f"| AT-PERM-003 | Эксперт не может менять пользователей | AT-USER-001.7, AT-USER-002.7 | {st('AT-PERM-003')} |")
    L.append(f"| AT-PERM-004 | Администратор имеет полный доступ в пределах BR | AT-AUTH-003.1, AT-AUTH-003.5 | {st('AT-PERM-004')} |")
    L.append(f"| AT-PERM-005 | UI restrictions не заменяют server-side authorization | AT-AUTH-003.2, AT-AUTH-003.7 | {st('AT-PERM-005')} |")
    L.append(f"| AT-PERM-MATRIX | Параметризованная проверка всех ячеек permission-model §4 без UI | SPEC-AUTH-003 | {st('AT-PERM-MATRIX')} |")
    L.append(f"| AT-E2E-001 | SC-E2E-001 через UI (Playwright) | scenarios/scenario-registry.md | {st('AT-E2E-001')} |")
    L.append(f"| AT-E2E-001-API | SC-E2E-001 через application services без UI | scenarios/scenario-registry.md | {st('AT-E2E-001-API')} |")
    L.append("")
    n_ac = sum(len(s["ac"]) for s in d["SPEC"].values())
    fr_m = [f for f, v in d["FR"].items() if v["prio"].startswith("M")]
    fr_cov = [f for f in fr_m if any(d["SPEC"].get(s, {}).get("ac") for s in d["FR"][f]["spec"])]
    br_cov = [b for b in d["BR"] if b in covered]
    L.append("## Сводка покрытия (спецификационное)\n")
    L.append("| Показатель | Значение |\n|---|---|")
    L.append(f"| Acceptance criteria / AT | {n_ac} |")
    L.append(f"| FR (Must) с AT | {len(fr_cov)} / {len(fr_m)} |")
    L.append(f"| BR с AT | {len(br_cov)} / {len(d['BR'])} |")
    n_pass = sum(1 for s_ in d["SPEC"].values() for a in s_["ac"] if results.get(at(a)) == "pass")
    n_fail = sum(1 for s_ in d["SPEC"].values() for a in s_["ac"] if results.get(at(a)) == "fail")
    req_pass = 0
    for r in sorted(total_req):
        specs = [x for x, v in d["SPEC"].items() if r in v["req"] + v["br"]]
        ats_r = [at(a) for sp in specs for a in d["SPEC"][sp]["ac"]]
        if ats_r and any(results.get(x) == "pass" for x in ats_r):
            req_pass += 1
    L.append(f"| Проходящих AT | {n_pass} / {n_ac} |")
    L.append(f"| Падающих AT | {n_fail} |")
    L.append(f"| Требований (FR/NFR/BR) с ≥1 проходящим AT | {req_pass} / {len(total_req)} ({round(100 * req_pass / max(1, len(total_req)))}%) |")
    L.append(f"| Ошибок целостности ссылок | {len(errors)} |")
    return "\n".join(L) + "\n"


def main():
    d = load()
    errors, warnings = check(d)
    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    print(f"FR={len(d['FR'])} BR={len(d['BR'])} NFR={len(d['NFR'])} SC={len(d['SC'])} SPEC={len(d['SPEC'])} "
          f"AC={sum(len(s['ac']) for s in d['SPEC'].values())} T={len(d['T'])} errors={len(errors)} warnings={len(warnings)}")
    if "--check" not in sys.argv:
        (ROOT / "validation").mkdir(exist_ok=True)
        (ROOT / "validation/traceability-matrix.md").write_text(build_traceability(d), encoding="utf-8")
        (ROOT / "validation/acceptance-matrix.md").write_text(build_acceptance(d, errors), encoding="utf-8")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
