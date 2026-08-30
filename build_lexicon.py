#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build the vocabulary test lexicon from the Youdao book zip files.

Output: project/data/lexicon.json  with each entry
  { surface_form, frequency_rank, is_pseudo, layer_id, difficulty_b }

Frequency rank assignment strategy:
  - Parse every book, collect the set of books each headWord appears in.
  - Each book has a difficulty tier (1=easiest ... 11=hardest).
  - A word's effective tier = the EASIEST tier among all books containing it
    (a word is considered "known at that level").
  - Sort words by (effective_tier, headWord) and assign frequency_rank starting at 1.
    => Smaller rank = more common/easier word.
  - Pseudo words are generated to look plausible and appended with is_pseudo=true.
"""

import json
import os
import random
import re
import zipfile
from collections import defaultdict

random.seed(42)

BOOK_DIR = "book"
OUT_DIR = "project/data"
OUT_FILE = os.path.join(OUT_DIR, "lexicon.json")

# tier mapping (lower = more frequent / easier)
def book_id_tier(book_id: str) -> int:
    bid = book_id.lower()
    if "xiaoXue".lower() in bid:
        return 1
    if "chuzhong" in bid or "waiyanshechuzhong" in bid:
        return 2
    if "gaozhong" in bid or "beishi" in bid:
        return 3
    if "cet4" in bid or "level4" in bid:
        return 4
    if "bec" in bid:
        return 5
    if "cet6" in bid or "level8" in bid:
        return 6
    if "kaoyan" in bid:
        return 7
    if "ielts" in bid or "toefl" in bid:
        return 8
    if "sat" in bid or "gmat" in bid:
        return 9
    if "gre" in bid:
        return 10
    return 11  # unknown -> hardest


def is_real_word(w: str) -> bool:
    """Keep single alphabetic tokens only (drop phrases)."""
    w = w.strip()
    if " " in w:
        return False
    if not w:
        return False
    if not re.fullmatch(r"[A-Za-z][A-Za-z\-']*", w):
        return False
    return True


def main():
    word_books = defaultdict(set)        # word -> set of book_ids
    word_best_tier = {}                  # word -> best (lowest) tier
    word_meaning = {}                    # word -> Chinese meaning (tranCn)

    zfiles = [f for f in os.listdir(BOOK_DIR) if f.endswith(".zip")]
    zfiles.sort()

    def clean_meaning(s):
        if not s:
            return ""
        s = s.strip()
        # 去掉前导词性标记如 "vt. " "n. "
        import re as _re
        s = _re.sub(r"^(vt|vi|n|v|adj|adv|art|prep|conj|pron|num|aux|abbr|int|modal)\s*\.\s*", "", s)
        s = s.strip()
        return s

    for zf_name in zfiles:
        path = os.path.join(BOOK_DIR, zf_name)
        try:
            zf = zipfile.ZipFile(path)
        except Exception as e:
            print(f"skip {zf_name}: {e}")
            continue
        for name in zf.namelist():
            if not name.endswith(".json"):
                continue
            try:
                with zf.open(name) as f:
                    raw = f.read().decode("utf-8", errors="ignore")
            except Exception:
                continue
            book_id = None
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
                if not hw:
                    continue
                if book_id is None:
                    book_id = obj.get("bookId") or name.replace(".json", "")
                if not is_real_word(hw):
                    continue
                hw_lower = hw.lower()
                word_books[hw_lower].add(book_id or name)
                # 提取中文释义 (取第一个 trans.tranCn, 若无则用 sentence.sCn 的合并)
                if hw_lower not in word_meaning or not word_meaning[hw_lower]:
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
                    if m:
                        word_meaning[hw_lower] = m
        zf.close()

    # compute best tier for each word
    for w, books in word_books.items():
        tier = min(book_id_tier(b) for b in books)
        word_best_tier[w] = tier

    # sort by (tier, word) -> assign frequency_rank
    # 只保留有中文释义的真实词进入主库 (用于释义选择题)
    sorted_words = sorted(word_best_tier.items(), key=lambda kv: (kv[1], kv[0]))
    real_entries = []
    for idx, (w, tier) in enumerate(sorted_words, start=1):
        m = word_meaning.get(w, "")
        real_entries.append({
            "surface_form": w,
            "frequency_rank": idx,
            "is_pseudo": False,
            "meaning": m,
        })
    # 统计无释义词数
    no_meaning = sum(1 for e in real_entries if not e["meaning"])
    print(f"Real words without meaning (will still be in lib, meaning-test skipped): {no_meaning}")

    # generate pseudo words: plausible-looking non-words
    pseudo_pool = _generate_pseudo_words(120)
    pseudo_entries = [{"surface_form": w, "frequency_rank": None, "is_pseudo": True} for w in pseudo_pool]

    all_entries = real_entries + pseudo_entries
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_entries, f, ensure_ascii=False)
    print(f"Real words: {len(real_entries)}")
    print(f"Pseudo words: {len(pseudo_entries)}")
    print(f"Total: {len(all_entries)} -> {OUT_FILE}")
    # sample tiers
    tier_counts = defaultdict(int)
    for w, t in word_best_tier.items():
        tier_counts[t] += 1
    print("Tier distribution:", dict(sorted(tier_counts.items())))


# ---------- pseudo word generator ----------
CONSONANTS = "bcdfghjklmnpqrstvwz"
VOWELS = "aeiou"


def _generate_pseudo_words(n: int):
    real_set = {w["surface_form"] for w in []}  # placeholder, we re-load below
    # reload real words from this run's entries
    # (we pass real set from caller via closure-ish approach)
    global _REAL_WORD_SET
    out = set()
    attempts = 0
    while len(out) < n and attempts < n * 50:
        attempts += 1
        w = _make_one_pseudo()
        if w in _REAL_WORD_SET:
            continue
        out.add(w)
    return list(out)


_REAL_WORD_SET = set()


def _make_one_pseudo() -> str:
    length = random.randint(4, 9)
    out = []
    use_vowel = random.random() < 0.5
    for i in range(length):
        if use_vowel:
            out.append(random.choice(VOWELS))
        else:
            out.append(random.choice(CONSONANTS))
        use_vowel = not use_vowel
    w = "".join(out)
    # ensure it ends with a vowel-ish or common ending
    if random.random() < 0.3:
        w += random.choice(["e", "er", "y", "ion", "ed", "ing"])
    return w


if __name__ == "__main__":
    # build real set first by re-scanning (cheap relative to full parse, but we already have it)
    # We'll do a quick scan to populate _REAL_WORD_SET so pseudo words don't collide.
    word_books2 = defaultdict(set)
    for zf_name in os.listdir(BOOK_DIR):
        if not zf_name.endswith(".zip"):
            continue
        try:
            zf = zipfile.ZipFile(os.path.join(BOOK_DIR, zf_name))
        except Exception:
            continue
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
                if hw and is_real_word(hw):
                    _REAL_WORD_SET.add(hw.lower())
        zf.close()
    main()
