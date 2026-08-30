#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build the curriculum-targeted wordlist (义务教育课标范围, 到九年级下学期).

Sources (Youdao book zips in book/):
  - 外研版初中英语 1-6 册 (七上/七下/八上/八下/九上/九下) -> grade 1..6
  - 有道中考必备词汇 (ChuZhong_2, 依据教育部课标) -> 补充课标词
  - 人教版初中英语 (PEPChuZhong) -> 补充教材词

Output: project/data/curriculum.json
  [{ surface_form, meaning, grade }]  grade: 1=七上 ... 6=九下/中考
  grade = 最早出现的外研版册次; 仅在课标/人教词表中的词 grade=6 (按九下总复习处理)
"""
import json
import os
import re
import zipfile
from collections import defaultdict

BOOK_DIR = "book"
OUT_FILE = "project/data/curriculum.json"

# 外研版初中: book_id -> grade (1..6, 六册 = 七上..九下)
WY_GRADE = {
    "WaiYanSheChuZhong_1": 1,  # 七年级上册
    "WaiYanSheChuZhong_2": 2,  # 七年级下册
    "WaiYanSheChuZhong_3": 3,  # 八年级上册
    "WaiYanSheChuZhong_4": 4,  # 八年级下册
    "WaiYanSheChuZhong_5": 5,  # 九年级上册
    "WaiYanSheChuZhong_6": 6,  # 九年级下册
}

def is_real_word(w: str) -> bool:
    w = w.strip()
    if " " in w or not w:
        return False
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z\-']*", w))

def clean_meaning(s):
    if not s:
        return ""
    s = s.strip()
    s = re.sub(r"^(vt|vi|n|v|adj|adv|art|prep|conj|pron|num|aux|abbr|int|modal)\s*\.\s*", "", s)
    return s.strip()

def parse_zip(path):
    """yield (headWord, meaning) from a book zip"""
    out = []
    try:
        zf = zipfile.ZipFile(path)
    except Exception:
        return out
    for name in zf.namelist():
        if not name.endswith(".json"):
            continue
        try:
            with zf.open(name) as f:
                raw = f.read().decode("utf-8", errors="ignore")
        except Exception:
            continue
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if not isinstance(obj, dict):
                continue
            hw = obj.get("headWord")
            if not hw or not is_real_word(hw):
                continue
            content = obj.get("content") or {}
            wobj = content.get("word") or {}
            cobj = wobj.get("content") or {}
            trans = cobj.get("trans") or []
            m = ""
            if trans and isinstance(trans, list):
                for t in trans:
                    tc = t.get("tranCn") if isinstance(t, dict) else None
                    if tc:
                        m = clean_meaning(tc)
                        break
            if not m:
                sent = (cobj.get("sentence") or {}).get("sentences") or []
                for s in sent:
                    sc = s.get("sCn") if isinstance(s, dict) else None
                    if sc:
                        m = sc
                        break
            out.append((hw.lower(), m))
    zf.close()
    return out

def main():
    # grade_map: word -> earliest 外研版 grade
    grade_map = {}
    meaning_map = {}

    # 1. 外研版 1-6 册 (确定 grade)
    for bid, grade in WY_GRADE.items():
        # 实际文件名时间戳不同, 直接按关键字匹配
        found = [f for f in os.listdir(BOOK_DIR) if bid in f]
        if not found:
            print("WARN missing", bid)
            continue
        words = parse_zip(os.path.join(BOOK_DIR, found[0]))
        for w, m in words:
            if w not in grade_map or grade < grade_map[w]:
                grade_map[w] = grade
            if m and w not in meaning_map:
                meaning_map[w] = m
        print("%s (grade %d): %d words" % (bid, grade, len(words)))

    # 2. 中考必备词汇 (课标词表) + 人教版初中 — 补充释义与未收录词
    extra_zips = [f for f in os.listdir(BOOK_DIR)
                  if ("ChuZhong_2" in f or "ChuZhongluan_2" in f or "PEPChuZhong" in f)
                  and f.endswith(".zip")]
    curricular_extra = set()
    for zf_name in extra_zips:
        words = parse_zip(os.path.join(BOOK_DIR, zf_name))
        for w, m in words:
            if m and w not in meaning_map:
                meaning_map[w] = m
            if w not in grade_map:
                curricular_extra.add(w)
        print("%s: %d words" % (zf_name, len(words)))

    # 3. 组装: 外研版词 (有 grade) + 课标补充词 (grade=6)
    #    只保留有中文释义的词 (测试需要)
    entries = []
    for w, g in sorted(grade_map.items(), key=lambda kv: (kv[1], kv[0])):
        m = meaning_map.get(w, "")
        if not m:
            continue
        entries.append({"surface_form": w, "meaning": m, "grade": g})
    wy_count = len(entries)
    for w in sorted(curricular_extra):
        m = meaning_map.get(w, "")
        if not m:
            continue
        entries.append({"surface_form": w, "meaning": m, "grade": 6})

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False)

    # 4. 并入主词库的假词 (诚实度检测用)
    lex_path = "project/data/lexicon.json"
    if os.path.exists(lex_path):
        with open(lex_path, encoding="utf-8") as f:
            lex = json.load(f)
        pseudos = [{"surface_form": w["surface_form"], "is_pseudo": True}
                   for w in lex if w.get("is_pseudo")]
        with open(OUT_FILE, encoding="utf-8") as f:
            entries = json.load(f)
        entries.extend(pseudos)
        with open(OUT_FILE, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False)
        print("假词并入: %d" % len(pseudos))

    # 统计
    by_grade = defaultdict(int)
    for e in entries:
        if e.get("is_pseudo"):
            continue
        by_grade[e["grade"]] += 1
    print("\n外研版词: %d, 课标补充: %d, 总计: %d" % (wy_count, len(entries) - wy_count, len(entries)))
    print("按册分布:", dict(sorted(by_grade.items())))

if __name__ == "__main__":
    main()
