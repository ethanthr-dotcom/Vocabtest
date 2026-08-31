/**
 * 词汇量测试核心算法 (3PL IRT + 自适应选题 + 三题型交叉验证 + 假词检测)
 *
 * 题型: know(认识/不认识) / meaning(中文释义) / syn(近义反义词)
 *
 * 公开 API:
 *   preprocessLexicon(rawWords)
 *   createTestSession(processed, excludeIds)
 *   selectNextWord(session, processed) -> question
 *   recordAnswer(session, processed, known, rt, explicitUnknown)
 *   isTestFinished(session)
 *   computeFinalResult(session, processed)
 *   standardError(responses, theta)
 *   getSessionAskedIds(session)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.VocabAlgorithm = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CONFIG = {
    TOTAL_QUESTIONS: 50,      // 默认 50 题 (可选 120)
    PSEUDO_INTERVAL: 8,       // 每 8 题插 1 个假词
    PSEUDO_OFFSET: 3,
    MIN_PER_LAYER: 5,
    INITIAL_THETA: 0,
    THETA_MIN: -4,
    THETA_MAX: 4,
    MAX_ITER: 30,
    CONVERGE_TOL: 0.001,
    MAX_STEP: 1.0,            // 牛顿单步截断
    MIN_RT_MS: 300,
    FPR_THRESHOLD: 0.2,
    Z_95: 1.96,
    // ===== 3PL 猜测/虚报基线 (防虚高的核心) =====
    KNOW_C: 0.30,             // know 题: "眼熟就算认识"的虚报基线
    CHOICE_C: 0.25,           // 选择题(释义/近义反义): 4 选 1 猜测基线
    KNOW_WEIGHT: 0.35,        // know 题降权
    LOW_LAYER_WEIGHT: 0.8,    // 低频层(5-7)响应打折
    SHRINK_K: 14,             // θ 先验收缩强度
    CALIBRATION_FACTOR: 1.0
  };

  // ===== 课标靶向模式: 册别层 (七上..九下) =====
  var GRADE_LABELS = {
    1: "七年级上册", 2: "七年级下册", 3: "八年级上册",
    4: "八年级下册", 5: "九年级上册", 6: "九年级下册"
  };
  // 册别锚点难度 b (难度递增)
  var GRADE_ANCHOR_B = {
    1: -2.5, 2: -1.5, 3: -0.5, 4: 0.5, 5: 1.5, 6: 2.5
  };

  var QTYPE_KNOW = "know";
  var QTYPE_MEANING = "meaning";
  var QTYPE_SYN = "syn";

  var LAYER_RANGES = [
    { id: 1, low: 1, high: 1000, label: "1-1000 (最常用)" },
    { id: 2, low: 1001, high: 2000, label: "1001-2000" },
    { id: 3, low: 2001, high: 3000, label: "2001-3000" },
    { id: 4, low: 3001, high: 5000, label: "3001-5000" },
    { id: 5, low: 5001, high: 10000, label: "5001-10000" },
    { id: 6, low: 10001, high: 20000, label: "10001-20000" },
    { id: 7, low: 20001, high: Infinity, label: "20000+" }
  ];

  // 每层锚点难度 b
  var LAYER_ANCHOR_B = {
    1: -6.0, 2: -4.0, 3: -2.0, 4: 0.0,
    5: 3.0, 6: 6.0, 7: 9.0
  };

  // 近义/反义词对表 [词A, 词B, 1=近义 0=反义]
  // 运行时校验两词都在词库中, 不在则跳过
  var WORD_PAIRS = [
    ["quick", "rapid", 1], ["quick", "slow", 0], ["happy", "glad", 1],
    ["happy", "sad", 0], ["big", "large", 1], ["big", "small", 0],
    ["small", "tiny", 1], ["smart", "clever", 1], ["begin", "start", 1],
    ["end", "finish", 1], ["help", "assist", 1], ["rich", "wealthy", 1],
    ["rich", "poor", 0], ["strong", "powerful", 1], ["strong", "weak", 0],
    ["weak", "feeble", 1], ["beautiful", "pretty", 1], ["tired", "exhausted", 1],
    ["angry", "furious", 1], ["scared", "afraid", 1], ["strange", "odd", 1],
    ["important", "crucial", 1], ["famous", "well", 1], ["quiet", "silent", 1],
    ["loud", "noisy", 1], ["fast", "slow", 0], ["easy", "simple", 1],
    ["easy", "hard", 0], ["difficult", "hard", 1], ["dangerous", "risky", 1],
    ["safe", "dangerous", 0], ["smart", "stupid", 0], ["brave", "courageous", 1],
    ["brave", "cowardly", 0], ["honest", "truthful", 1], ["real", "genuine", 1],
    ["real", "fake", 0], ["huge", "enormous", 1], ["old", "ancient", 1],
    ["old", "new", 0], ["new", "modern", 1], ["correct", "accurate", 1],
    ["correct", "wrong", 0], ["increase", "rise", 1], ["increase", "decrease", 0],
    ["buy", "purchase", 1], ["buy", "sell", 0], ["obtain", "acquire", 1],
    ["keep", "retain", 1], ["stop", "halt", 1], ["show", "display", 1],
    ["hide", "conceal", 1], ["find", "discover", 1], ["find", "lose", 0],
    ["make", "create", 1], ["destroy", "ruin", 1], ["build", "construct", 1],
    ["think", "consider", 1], ["want", "desire", 1], ["need", "require", 1],
    ["allow", "permit", 1], ["allow", "forbid", 0], ["ask", "inquire", 1],
    ["answer", "reply", 1], ["tell", "inform", 1], ["speak", "talk", 1],
    ["look", "gaze", 1], ["see", "observe", 1], ["cry", "weep", 1],
    ["laugh", "cry", 0], ["work", "labor", 1], ["rest", "relax", 1],
    ["eat", "consume", 1], ["strange", "weird", 1], ["polite", "courteous", 1],
    ["polite", "rude", 0], ["kind", "friendly", 1], ["cruel", "merciless", 1],
    ["gentle", "mild", 1], ["fierce", "violent", 1], ["calm", "peaceful", 1],
    ["calm", "fierce", 0], ["worried", "anxious", 1], ["excited", "thrilled", 1],
    ["lucky", "fortunate", 1], ["lucky", "unfortunate", 0], ["usual", "ordinary", 1],
    ["special", "unique", 1], ["special", "ordinary", 0], ["common", "widespread", 1],
    ["rare", "scarce", 1], ["rare", "common", 0], ["expensive", "costly", 1],
    ["expensive", "cheap", 0], ["empty", "vacant", 1], ["empty", "full", 0],
    ["heavy", "weighty", 1], ["bright", "brilliant", 1], ["bright", "dark", 0],
    ["dark", "dim", 1], ["clean", "dirty", 0], ["wet", "dry", 0],
    ["hot", "cold", 0], ["hot", "scorching", 1], ["cold", "freezing", 1],
    ["long", "short", 0], ["tall", "short", 0], ["day", "night", 0],
    ["open", "close", 0], ["win", "lose", 0], ["love", "hate", 0],
    ["early", "late", 0], ["young", "old", 0], ["first", "last", 0],
    ["up", "down", 0], ["good", "bad", 0], ["right", "wrong", 0],
    ["true", "false", 0], ["always", "never", 0], ["often", "rarely", 0],
    ["more", "less", 0], ["all", "none", 0], ["appear", "disappear", 0],
    ["arrive", "depart", 0], ["give", "receive", 0], ["borrow", "lend", 0],
    ["push", "pull", 0], ["enter", "exit", 0], ["rise", "fall", 0],
    ["grow", "shrink", 0], ["expand", "contract", 0], ["remember", "forget", 0],
    ["succeed", "fail", 0], ["attack", "defend", 0], ["reward", "punish", 0],
    ["accept", "reject", 0], ["agree", "disagree", 0], ["include", "exclude", 0],
    ["connect", "separate", 0], ["unite", "divide", 0], ["warm", "cool", 0],
    ["safe", "secure", 1], ["possible", "impossible", 0], ["visible", "invisible", 0],
    ["major", "minor", 0], ["superior", "inferior", 0], ["legal", "illegal", 0],
    ["generous", "stingy", 0], ["optimistic", "pessimistic", 0],
    ["positive", "negative", 0], ["active", "passive", 0], ["alive", "dead", 0],
    ["awake", "asleep", 0], ["friend", "enemy", 0], ["war", "peace", 0],
    ["soft", "hard", 0], ["smooth", "rough", 0], ["sharp", "dull", 0],
    ["thick", "thin", 0], ["wide", "narrow", 0], ["deep", "shallow", 0],
    ["near", "far", 0], ["inside", "outside", 0], ["internal", "external", 0],
    ["public", "private", 0], ["urban", "rural", 0], ["import", "export", 0],
    ["profit", "loss", 0], ["supply", "demand", 0], ["temporary", "permanent", 0],
    ["ancient", "modern", 0], ["natural", "artificial", 0], ["simple", "complex", 0],
    ["simple", "complicated", 1], ["abundant", "plentiful", 1],
    ["abundant", "scarce", 0], ["adverse", "unfavorable", 1], ["augment", "increase", 1],
    ["bleak", "dreary", 1], ["candid", "frank", 1], ["concise", "brief", 1],
    ["crucial", "vital", 1], ["deliberate", "intentional", 1], ["dense", "thick", 1],
    ["dense", "sparse", 0], ["diminish", "decrease", 1], ["distinct", "clear", 1],
    ["diverse", "varied", 1], ["eager", "keen", 1], ["eager", "reluctant", 0],
    ["essential", "necessary", 1], ["evident", "obvious", 1], ["explicit", "clear", 1],
    ["explicit", "implicit", 0], ["fertile", "barren", 0], ["flexible", "rigid", 0],
    ["fragile", "sturdy", 0], ["fragile", "weak", 1], ["genuine", "authentic", 1],
    ["gradual", "slow", 1], ["harsh", "gentle", 0], ["hostile", "unfriendly", 1],
    ["hostile", "friendly", 0], ["humble", "arrogant", 0], ["humble", "modest", 1],
    ["idle", "busy", 0], ["immense", "enormous", 1], ["inevitable", "unavoidable", 1],
    ["inferior", "superior", 0], ["innocent", "guilty", 0], ["intense", "extreme", 1],
    ["intense", "mild", 0], ["intricate", "complex", 1], ["junior", "senior", 0],
    ["lengthy", "long", 1], ["magnify", "enlarge", 1], ["mandatory", "optional", 0],
    ["maximum", "minimum", 0], ["minute", "tiny", 1], ["myriad", "countless", 1],
    ["novel", "new", 1], ["novel", "old", 0], ["obsolete", "outdated", 1],
    ["obstinate", "stubborn", 1], ["obvious", "evident", 1], ["optimal", "best", 1],
    ["permanent", "temporary", 0], ["plentiful", "abundant", 1],
    ["precise", "accurate", 1], ["precise", "vague", 0], ["profound", "deep", 1],
    ["prolong", "extend", 1], ["prudent", "cautious", 1], ["prudent", "reckless", 0],
    ["rare", "uncommon", 1], ["redundant", "superfluous", 1], ["remarkable", "notable", 1],
    ["robust", "sturdy", 1], ["severe", "serious", 1], ["significant", "notable", 1],
    ["simultaneous", "concurrent", 1], ["sufficient", "enough", 1],
    ["sufficient", "inadequate", 0], ["terminate", "end", 1], ["tremendous", "enormous", 1],
    ["trivial", "significant", 0], ["vague", "unclear", 1], ["vague", "clear", 0],
    ["valid", "legitimate", 1], ["verify", "confirm", 1], ["vigilant", "watchful", 1],
    ["vital", "essential", 1], ["widespread", "prevalent", 1],
    ["prominent", "obscure", 0], ["prominent", "famous", 1], ["scarce", "abundant", 0],
    ["stern", "lenient", 0], ["strict", "lenient", 0], ["stingy", "generous", 0],
    ["transparent", "opaque", 0], ["voluntary", "compulsory", 0],
    ["ruthless", "merciful", 0], ["refined", "crude", 0], ["relevant", "irrelevant", 0],
    ["reluctant", "willing", 0], ["modest", "boastful", 0], ["novice", "expert", 0],
    ["ordinary", "exceptional", 0], ["partial", "complete", 0], ["grim", "cheerful", 0],
    ["hollow", "solid", 0], ["bold", "timid", 0], ["cautious", "reckless", 0],
    ["compress", "expand", 0], ["conceal", "reveal", 0], ["converge", "diverge", 0],
    ["decrease", "increase", 0], ["deliberate", "accidental", 0],
    ["discourage", "encourage", 0], ["elaborate", "simple", 0],
    ["fake", "genuine", 0], ["fake", "real", 0], ["inferior", "superior", 0]
  ];

  function getLayerId(rank) {
    if (rank == null) return null;
    for (var i = 0; i < LAYER_RANGES.length; i++) {
      var L = LAYER_RANGES[i];
      if (rank >= L.low && rank <= L.high) return L.id;
    }
    return LAYER_RANGES.length;
  }

  function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  // ---------- 预处理 ----------
  // rawWords 带 grade 字段 -> 课标靶向模式 (层=册别); 否则标准模式 (层=词频段)
  function preprocessLexicon(rawWords) {
    var realWords = [];
    var pseudoWords = [];
    var isCurriculum = rawWords.length > 0 && rawWords[0].grade != null;

    rawWords.forEach(function (w, i) {
      var entry = {
        id: i,
        surface_form: w.surface_form,
        frequency_rank: w.frequency_rank,
        is_pseudo: !!w.is_pseudo,
        meaning: w.meaning || "",
        grade: (w.grade != null) ? w.grade : null,
        layer_id: null,
        difficulty_b: 0
      };
      if (entry.is_pseudo) pseudoWords.push(entry);
      else realWords.push(entry);
    });

    // 层锚点 b + 层内小幅扰动
    var byLayer = {};
    realWords.forEach(function (w) {
      w.layer_id = isCurriculum ? (w.grade || 6) : getLayerId(w.frequency_rank);
      if (!byLayer[w.layer_id]) byLayer[w.layer_id] = [];
      byLayer[w.layer_id].push(w);
    });
    var anchorTable = isCurriculum ? GRADE_ANCHOR_B : LAYER_ANCHOR_B;
    Object.keys(byLayer).forEach(function (lid) {
      var arr = byLayer[lid];
      arr.sort(function (a, b) {
        return ((a.frequency_rank || 0) - (b.frequency_rank || 0)) ||
               (a.surface_form < b.surface_form ? -1 : 1);
      });
      var anchor = (anchorTable[lid] != null) ? anchorTable[lid] : 0;
      var n = arr.length;
      var spread = 0.6;
      for (var i = 0; i < n; i++) {
        var pos = n > 1 ? (i / (n - 1) - 0.5) : 0;
        arr[i].difficulty_b = anchor + pos * spread;
      }
    });

    // 假词 difficulty_b
    pseudoWords.forEach(function (w) {
      var seed = (w.id * 9301 + 49297) % 233280;
      var r = seed / 233280;
      w.difficulty_b = -6 + r * 15;
    });

    // 近义/反义索引: surface_form -> [{other, type}], 仅保留两词都在词库中的词对
    var lookup = {};
    realWords.forEach(function (w) { lookup[w.surface_form] = w; });
    var synIndex = {};
    WORD_PAIRS.forEach(function (p) {
      var a = lookup[p[0]], b = lookup[p[1]];
      if (!a || !b) return;
      if (!synIndex[p[0]]) synIndex[p[0]] = [];
      if (!synIndex[p[1]]) synIndex[p[1]] = [];
      synIndex[p[0]].push({ other: p[1], otherWord: b, type: p[2] });
      synIndex[p[1]].push({ other: p[0], otherWord: a, type: p[2] });
    });
    var synWords = realWords.filter(function (w) {
      return synIndex[w.surface_form] && synIndex[w.surface_form].length > 0;
    });

    // 分层索引: 靶向模式用册别, 标准模式用词频段 (anchor 存层锚点 b, 供分层估计用)
    var layers;
    if (isCurriculum) {
      layers = Object.keys(GRADE_LABELS).map(function (gid) {
        var g = parseInt(gid, 10);
        var items = realWords.filter(function (w) { return w.layer_id === g; });
        return {
          id: g, label: GRADE_LABELS[g], low: null, high: null,
          anchor: GRADE_ANCHOR_B[g] || 0,
          count: items.length, words: items
        };
      }).filter(function (L) { return L.count > 0; });
    } else {
      layers = LAYER_RANGES.map(function (L) {
        var items = realWords.filter(function (w) { return w.layer_id === L.id; });
        return {
          id: L.id, label: L.label, low: L.low,
          high: L.high === Infinity ? null : L.high,
          anchor: LAYER_ANCHOR_B[L.id] || 0,
          count: items.length, words: items
        };
      });
    }

    return {
      lexicon: realWords.concat(pseudoWords),
      realWords: realWords,
      pseudoWords: pseudoWords,
      meanLogRank: 0,
      isCurriculum: isCurriculum,
      layers: layers,
      synIndex: synIndex,
      synWords: synWords
    };
  }

  // ---------- 能力估计 (加权牛顿-拉夫森, 3PL) ----------
  function estimateTheta(responses, initialTheta) {
    var theta = (initialTheta == null) ? CONFIG.INITIAL_THETA : initialTheta;
    if (responses.length === 0) return theta;

    // 极端作答保护
    var score = 0;
    for (var s = 0; s < responses.length; s++) score += responses[s].u;
    if (score === 0) return Math.max(CONFIG.THETA_MIN, theta - 0.5);
    if (score >= responses.length) return Math.min(CONFIG.THETA_MAX, theta + 0.5);

    for (var iter = 0; iter < CONFIG.MAX_ITER; iter++) {
      var sumDiff = 0, sumPQ = 0;
      for (var i = 0; i < responses.length; i++) {
        var r = responses[i];
        var g = (r.c != null) ? r.c : 0;
        var p = sigmoid(theta - r.b);
        var pModel = g + (1 - g) * p;
        var wgt = (r.w != null) ? r.w : 1;
        sumDiff += wgt * (r.u - pModel);
        sumPQ += wgt * (1 - g) * p * (1 - p);
      }
      if (sumPQ === 0) break;
      var delta = sumDiff / sumPQ;
      if (delta > CONFIG.MAX_STEP) delta = CONFIG.MAX_STEP;
      if (delta < -CONFIG.MAX_STEP) delta = -CONFIG.MAX_STEP;
      theta += delta;
      if (Math.abs(delta) < CONFIG.CONVERGE_TOL) break;
    }
    if (theta < CONFIG.THETA_MIN) theta = CONFIG.THETA_MIN;
    if (theta > CONFIG.THETA_MAX) theta = CONFIG.THETA_MAX;
    return theta;
  }

  // Fisher 信息量与标准误
  function standardError(responses, theta) {
    if (!responses || !responses.length) return Infinity;
    var info = 0;
    for (var i = 0; i < responses.length; i++) {
      var r = responses[i];
      var g = (r.c != null) ? r.c : 0;
      var p = sigmoid(theta - r.b);
      var wgt = (r.w != null) ? r.w : 1;
      info += wgt * (1 - g) * p * (1 - p);
    }
    return info <= 1e-5 ? Infinity : 1 / Math.sqrt(info);
  }

  // 数据驱动先验: 加权去猜测对率粗定 θ 锚点
  function roughPrior(responses) {
    if (!responses.length) return CONFIG.INITIAL_THETA;
    var wSum = 0, uSum = 0;
    for (var i = 0; i < responses.length; i++) {
      var r = responses[i];
      var wgt = (r.w != null) ? r.w : 1;
      var g = (r.c != null) ? r.c : 0;
      wSum += wgt;
      uSum += wgt * Math.max(0, (r.u - g) / (1 - g));
    }
    var acc = wSum > 0 ? uSum / wSum : 0.5;
    return Math.max(CONFIG.THETA_MIN, Math.min(CONFIG.THETA_MAX, (acc - 0.5) * 10));
  }

  function shrinkTheta(thetaMle, n, responses) {
    var prior = roughPrior(responses);
    var lambda = n / (n + CONFIG.SHRINK_K);
    return prior + lambda * (thetaMle - prior);
  }

  // ---------- 自适应选题 ----------
  // 最大信息量选题, 信息量接近时随机抽取
  function selectClosest(candidates, theta) {
    if (!candidates.length) return null;
    var bestDist = Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var d = Math.abs(candidates[i].difficulty_b - theta);
      if (d < bestDist) bestDist = d;
    }
    var pool = [];
    for (var j = 0; j < candidates.length; j++) {
      if (Math.abs(candidates[j].difficulty_b - theta) <= bestDist + 0.2) {
        pool.push(candidates[j]);
      }
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function isExcluded(session, id) {
    if (session.askedIds.has(id)) return true;
    if (session.excludeIds && session.excludeIds.has(id)) return true;
    return false;
  }

  function layerHasUnused(session, L) {
    for (var i = 0; i < L.words.length; i++) {
      if (!isExcluded(session, L.words[i].id)) return true;
    }
    return false;
  }

  // 每层题数配额: 保证各层均匀覆盖 (解决"分布不均")
  // 靶向模式: 各册均分; 标准模式: 按词数比例 (最少 3 题)
  function layerQuota(session, processed, L) {
    var total = session.totalQuestions || CONFIG.TOTAL_QUESTIONS;
    if (processed.isCurriculum) {
      return Math.ceil(total / processed.layers.length);
    }
    var q = Math.round(total * L.count / processed.realWords.length);
    return Math.max(3, q);
  }

  function selectRealWord(session, processed, theta) {
    var coverage = session.layerCoverage;

    // 候选: 有剩余词 且 未达配额 的层
    var eligible = [];
    processed.layers.forEach(function (L) {
      if (!L.words.length || !layerHasUnused(session, L)) return;
      if ((coverage[L.id] || 0) >= layerQuota(session, processed, L)) return;
      eligible.push(L);
    });

    var targetLayer = null;
    if (eligible.length) {
      if (session.questionNumber < 12) {
        // 前期: 配额轮转 (θ 与各层掌握率尚不可靠, 先均匀探测)
        var bestRatio = Infinity;
        eligible.forEach(function (L) {
          var ratio = (coverage[L.id] || 0) / layerQuota(session, processed, L);
          if (ratio < bestRatio - 1e-9) {
            bestRatio = ratio;
            targetLayer = L;
          }
        });
      } else {
        // 后期: Neyman 最优分配 — 选题投向"对总估计方差贡献最大"的层
        // 单层方差贡献 ∝ count² · m̂(1-m̂) / (n+1)
        // 注意 ph 必须用"校正后掌握率"(扣除猜测/虚报基线):
        // 若用 raw 正确率, 低掌握层的 ph(1-ph) 被基线虚高 ~10 倍, 会吸走过量题目
        var bestScore = -1;
        var bestLayers = [];
        eligible.forEach(function (L) {
          var n = coverage[L.id] || 0;
          var c = session.layerCorrect ? (session.layerCorrect[L.id] || 0) : 0;
          // raw 率 Laplace 平滑
          var raw = (c + 1) / (n + 2);
          // 校正: 扣除约 0.3 的猜测/虚报基线 (题型混合), 映射到真实掌握率
          var ph = clamp01((raw - 0.30) / 0.62);
          var score = L.count * L.count * ph * (1 - ph) / (n + 1);
          if (score > bestScore * 1.15) {
            bestScore = score;
            bestLayers = [L];
          } else if (score > bestScore / 1.15) {
            bestLayers.push(L);
          }
        });
        if (bestLayers.length) {
          targetLayer = bestLayers[Math.floor(Math.random() * bestLayers.length)];
        }
      }
    }

    if (targetLayer) {
      var pool = [];
      targetLayer.words.forEach(function (w) {
        if (!isExcluded(session, w.id)) pool.push(w);
      });
      if (pool.length) {
        // 层内选题: 前 10 题用层锚点中心 (θ 不可靠), 之后 θ 自适应
        var effTheta = session.questionNumber < 10
          ? targetLayer.words[0].difficulty_b + 0.0  // 层内中段由 selectClosest 的随机池保证
          : theta;
        // 错太多主动降难度
        var recentCorrect = 0, recentTotal = 0;
        for (var r = session.responses.length - 1; r >= 0 && recentTotal < 5; r--) {
          recentCorrect += session.responses[r].u;
          recentTotal++;
        }
        var recentAcc = recentTotal > 0 ? recentCorrect / recentTotal : 0.5;
        if (recentAcc < 0.4 && recentTotal >= 3) effTheta = effTheta - 1.2;
        return selectClosest(pool, effTheta);
      }
    }

    // 所有层配额满或无词 -> 全局自适应
    var all = [];
    processed.realWords.forEach(function (w) {
      if (!isExcluded(session, w.id)) all.push(w);
    });
    if (!all.length) return null;
    var effAll = theta;
    var rc = 0, rt = 0;
    for (var r2 = session.responses.length - 1; r2 >= 0 && rt < 5; r2--) {
      rc += session.responses[r2].u;
      rt++;
    }
    if (rt > 0 && rc / rt < 0.4 && rt >= 3) effAll = theta - 1.2;
    return selectClosest(all, effAll);
  }

  function selectPseudoWord(session, processed, theta) {
    var candidates = [];
    processed.pseudoWords.forEach(function (w) {
      if (!isExcluded(session, w.id)) candidates.push(w);
    });
    return selectClosest(candidates, theta);
  }

  // ---------- 释义选择题选项 ----------
  function buildMeaningOptions(word, processed) {
    var n = 4;
    var correctMeaning = word.meaning || "";
    var pool = [];
    if (word.layer_id != null) {
      for (var i = 0; i < processed.layers.length; i++) {
        if (processed.layers[i].id === word.layer_id) {
          processed.layers[i].words.forEach(function (w) {
            if (w.id !== word.id && w.meaning && w.meaning !== correctMeaning) pool.push(w.meaning);
          });
          break;
        }
      }
    }
    if (pool.length < n - 1) {
      processed.realWords.forEach(function (w) {
        if (w.id !== word.id && w.meaning && w.meaning !== correctMeaning &&
            pool.indexOf(w.meaning) === -1) pool.push(w.meaning);
      });
    }
    var distractors = [];
    var poolCopy = pool.slice();
    for (var k = 0; k < n - 1 && poolCopy.length; k++) {
      var idx = Math.floor(Math.random() * poolCopy.length);
      distractors.push(poolCopy.splice(idx, 1)[0]);
    }
    var options = distractors.slice();
    options.push(correctMeaning);
    for (var s = options.length - 1; s > 0; s--) {
      var j = Math.floor(Math.random() * (s + 1));
      var t = options[s]; options[s] = options[j]; options[j] = t;
    }
    var correctIndex = options.indexOf(correctMeaning);
    options.push("不认识");
    return { options: options, correctIndex: correctIndex };
  }

  // ---------- 近义/反义词题选项 ----------
  function buildSynOptions(word, processed) {
    var pairs = processed.synIndex[word.surface_form] || [];
    if (!pairs.length) return null;
    var pair = pairs[Math.floor(Math.random() * pairs.length)];
    var correct = pair.other;

    // 干扰项: 同层英文词, 排除目标词本身及其所有词对伙伴 (避免双正确答案)
    var partners = {};
    partners[word.surface_form] = true;
    pairs.forEach(function (p) { partners[p.other] = true; });

    var pool = [];
    if (word.layer_id != null) {
      for (var i = 0; i < processed.layers.length; i++) {
        if (processed.layers[i].id === word.layer_id) {
          processed.layers[i].words.forEach(function (w) {
            if (!partners[w.surface_form] && pool.indexOf(w.surface_form) === -1) {
              pool.push(w.surface_form);
            }
          });
          break;
        }
      }
    }
    if (pool.length < 3) {
      processed.realWords.forEach(function (w) {
        if (!partners[w.surface_form] && pool.indexOf(w.surface_form) === -1) {
          pool.push(w.surface_form);
        }
      });
    }
    var distractors = [];
    var poolCopy = pool.slice();
    for (var k = 0; k < 3 && poolCopy.length; k++) {
      var idx = Math.floor(Math.random() * poolCopy.length);
      distractors.push(poolCopy.splice(idx, 1)[0]);
    }
    if (distractors.length < 3) return null;

    var options = distractors.slice();
    options.push(correct);
    for (var s = options.length - 1; s > 0; s--) {
      var j = Math.floor(Math.random() * (s + 1));
      var t = options[s]; options[s] = options[j]; options[j] = t;
    }
    var correctIndex = options.indexOf(correct);
    options.push("不认识");
    var prompt = pair.type === 1
      ? "下面哪个是 " + word.surface_form + " 的近义词?"
      : "下面哪个是 " + word.surface_form + " 的反义词?";
    return { options: options, correctIndex: correctIndex, prompt: prompt };
  }

  // 题型序列: 50 题固定模式 (每 4 题一轮 know/meaning/syn/meaning)
  function typeForIndex(idx) {
    var m = idx % 4;
    if (m === 0) return QTYPE_KNOW;
    if (m === 2) return QTYPE_SYN;
    return QTYPE_MEANING;
  }

  function selectNextWord(session, processed) {
    if (session.questionNumber >= session.totalQuestions) return null;

    var oneBased = session.questionNumber + 1;
    var wantPseudo = (oneBased % CONFIG.PSEUDO_INTERVAL === CONFIG.PSEUDO_OFFSET);

    var word = null;
    var qtype = QTYPE_KNOW;
    var prompt = null;
    var options = null;
    var correctIndex = -1;

    if (wantPseudo) {
      var pw = selectPseudoWord(session, processed, session.theta);
      if (pw) word = pw;
    }

    if (!word) {
      var desired = typeForIndex(session.questionNumber);
      // 近义/反义题: 从有词对数据的词中选
      if (desired === QTYPE_SYN) {
        var synCandidates = [];
        processed.synWords.forEach(function (w) {
          if (!isExcluded(session, w.id)) synCandidates.push(w);
        });
        var synWord = selectClosest(synCandidates, session.theta);
        if (synWord) {
          var so = buildSynOptions(synWord, processed);
          if (so) {
            word = synWord;
            qtype = QTYPE_SYN;
            options = so.options;
            correctIndex = so.correctIndex;
            prompt = so.prompt;
          }
        }
      }
      // 释义题 / know 题 / syn 降级
      if (!word) {
        word = selectRealWord(session, processed, session.theta);
        if (word) {
          if (desired !== QTYPE_KNOW && word.meaning) {
            qtype = QTYPE_MEANING;
            var mo = buildMeaningOptions(word, processed);
            options = mo.options;
            correctIndex = mo.correctIndex;
            prompt = "下面哪个是 " + word.surface_form + " 的正确释义?";
          } else {
            qtype = QTYPE_KNOW;
          }
        }
      }
    }

    if (!word) return null;

    return {
      word: word,
      surface_form: word.surface_form,
      is_pseudo: word.is_pseudo,
      qtype: qtype,
      options: options,
      correctIndex: correctIndex,
      prompt: prompt
    };
  }

  // ---------- session 管理 ----------
  // options: { totalQuestions: 50|120 }
  function createTestSession(processed, excludeIds, options) {
    var opts = options || {};
    return {
      questionNumber: 0,
      totalQuestions: opts.totalQuestions || CONFIG.TOTAL_QUESTIONS,
      theta: CONFIG.INITIAL_THETA,
      responses: [],
      answerLog: [],
      askedIds: new Set(),
      excludeIds: excludeIds || null,
      layerCoverage: {},
      layerCorrect: {},       // layerId -> 答对数 (Neyman 分配用)
      pseudoMarkedKnown: 0,
      pseudoTotal: 0,
      thetaEstimated: false,
      startTime: Date.now()
    };
  }

  // explicitUnknown: 选择题中用户明确点了"不认识"按钮 (强负证据, c=0)
  function recordAnswer(session, processed, known, reactionTime, explicitUnknown) {
    var q = session.currentQuestion;
    if (q == null) return;
    var w = q.word;
    session.answerLog.push({
      word: w.surface_form,
      b: w.difficulty_b,
      is_pseudo: w.is_pseudo,
      qtype: q.qtype,
      u: known ? 1 : 0,
      rt: reactionTime
    });
    session.askedIds.add(w.id);

    if (w.is_pseudo) {
      session.pseudoTotal += 1;
      if (known) session.pseudoMarkedKnown += 1;
    } else {
      var lid = w.layer_id;
      if (lid != null) {
        session.layerCoverage[lid] = (session.layerCoverage[lid] || 0) + 1;
        if (known) session.layerCorrect[lid] = (session.layerCorrect[lid] || 0) + 1;
      }
      if (reactionTime == null || reactionTime >= CONFIG.MIN_RT_MS) {
        var uRaw = known ? 1 : 0;
        var cGuess = 0;
        var wgt = 1;
        // 3PL 一致性: 猜测参数 c 按题型固定, 不随作答结果变化
        // (之前"答对 c=0/答错 c=0.25"的写法会让乱猜猜对的难题变成纯能力证据, 系统性推高 θ)
        if (q.qtype === QTYPE_MEANING || q.qtype === QTYPE_SYN) {
          cGuess = CONFIG.CHOICE_C;
        } else {
          // know 题: "眼熟就算认识"虚报基线 + 降权
          cGuess = CONFIG.KNOW_C;
          wgt = CONFIG.KNOW_WEIGHT;
        }
        if (lid != null && lid >= 5) {
          wgt *= CONFIG.LOW_LAYER_WEIGHT;
        }
        session.responses.push({
          b: w.difficulty_b, u: uRaw, c: cGuess, w: wgt,
          layer_id: lid, qtype: q.qtype, rt: reactionTime
        });
        if (session.questionNumber >= 9 && !session.thetaEstimated) {
          var mle0 = estimateTheta(session.responses, CONFIG.INITIAL_THETA);
          session.theta = shrinkTheta(mle0, session.responses.length, session.responses);
          session.thetaEstimated = true;
        } else if (session.thetaEstimated) {
          var mle1 = estimateTheta(session.responses, session.theta);
          session.theta = shrinkTheta(mle1, session.responses.length, session.responses);
        }
      }
    }
    session.questionNumber += 1;
    session.currentQuestion = null;
  }

  function getSessionAskedIds(session) {
    var arr = [];
    session.askedIds.forEach(function (id) { arr.push(id); });
    return arr;
  }

  function isTestFinished(session) {
    return session.questionNumber >= session.totalQuestions;
  }

  // 分层实测掌握率 (两模式通用): 按题型校正行为基线, 选择题权重高于 know 题
  // choice: obs = 0.92m + 0.12(1-m)  ->  m = (obs-0.12)/0.80  (0.12=乱猜有效命中率)
  // know:   obs = m + KNOW_C(1-m)    ->  m = (obs-KNOW_C)/(1-KNOW_C)
  function stratifiedMastery(session, layerId) {
    var nKnow = 0, obsKnow = 0, nChoice = 0, obsChoice = 0;
    session.responses.forEach(function (r) {
      if (r.layer_id !== layerId) return;
      if (r.qtype === QTYPE_KNOW) {
        nKnow += 1;
        obsKnow += r.u;
      } else {
        nChoice += 1;
        obsChoice += r.u;
      }
    });
    // 选择题证据权重 1.0; know 题虚报基线个体差异大, 权重降至 0.3
    var num = 0, den = 0;
    if (nChoice >= 2) {
      num += nChoice * clamp01((obsChoice / nChoice - 0.12) / 0.80);
      den += nChoice;
    }
    if (nKnow >= 2) {
      var mk = clamp01((obsKnow / nKnow - CONFIG.KNOW_C) / (1 - CONFIG.KNOW_C));
      num += 0.3 * nKnow * mk;
      den += 0.3 * nKnow;
    }
    if (den === 0) return null;
    return num / den;
  }

  function clamp01(x) {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  // PAVA (pool adjacent violators algorithm): 输入按难度升序的 [{y, w}]
  // 输出加权最小二乘意义下的单调不增序列 (层越难掌握率不升)
  // 相邻"前层掌握率 < 后层"即违例 -> 池化为加权平均, 消除小样本噪声
  function pavaNonIncreasing(items) {
    var blocks = [];
    for (var i = 0; i < items.length; i++) {
      var b = { y: items[i].y, w: items[i].w, k: 1 };
      while (blocks.length && blocks[blocks.length - 1].y < b.y) {
        var prev = blocks.pop();
        var w = prev.w + b.w;
        b = { y: (prev.y * prev.w + b.y * b.w) / w, w: w, k: prev.k + b.k };
      }
      blocks.push(b);
    }
    var out = [];
    for (var j = 0; j < blocks.length; j++) {
      for (var t = 0; t < blocks[j].k; t++) out.push(blocks[j].y);
    }
    return out;
  }

  // ---------- 结果计算 ----------
  // 统一采用「分层实测掌握率」估计 (两模式通用):
  //   每层 m_obs = 实测正确率经题型猜测/虚报基线校正 (选择题为主, know 题降权)
  //   再向 IRT 先验 sigmoid(theta - anchor) 收缩 (样本少的层更靠先验)
  //   vocab = Σ m_final × 层词数
  // 这比单 θ 概率求和稳健: 词库层内排序非真实词频, 用户对高层有零散认识时,
  // 单 θ 会被拉高进而高估所有层; 分层实测则不受层内排序影响。
  function computeFinalResult(session, processed) {
    var thetaMle = estimateTheta(session.responses, CONFIG.INITIAL_THETA);
    var theta = shrinkTheta(thetaMle, session.responses.length, session.responses);

    // 各层实测统计
    var layerActual = {};
    session.responses.forEach(function (r) {
      if (r.layer_id == null) return;
      if (!layerActual[r.layer_id]) layerActual[r.layer_id] = { asked: 0, correct: 0 };
      layerActual[r.layer_id].asked += 1;
      layerActual[r.layer_id].correct += r.u;
    });

    // ---- 两步估计: 实测×先验混合 + PAVA 保序平滑 ----
    // PRIOR_W: 每层先验伪样本数, 随总题数自适应缩放。
    // 题少时 (50 题) 每层样本小, 二项噪声 + clamp01 不对称截断会拉高均值 (右尾无界),
    // 需更大先验权重压制; 题多时 (120 题) 数据可信, 先验退居次要。
    var PRIOR_W = 6 * 50 / (session.totalQuestions || CONFIG.TOTAL_QUESTIONS);
    var blended = processed.layers.map(function (L) {
      var act = layerActual[L.id] || { asked: 0, correct: 0 };
      // IRT 先验掌握率 (仅用层锚点, 不依赖层内伪排序)
      var mIrt = sigmoid(theta - (L.anchor || 0));
      var y = mIrt, w = PRIOR_W;
      if (act.asked > 0) {
        var m = stratifiedMastery(session, L.id);
        if (m != null) {
          y = (act.asked * m + PRIOR_W * mIrt) / (act.asked + PRIOR_W);
          w = act.asked + PRIOR_W;
        }
      }
      return { L: L, act: act, y: y, w: w };
    });

    // PAVA: 掌握率随层难度单调不增 (词汇学习的自然结构), 池化相邻违例消除小样本噪声
    var smoothed = pavaNonIncreasing(blended.map(function (b) { return { y: b.y, w: b.w }; }));

    var total = 0;
    var variance = 0;
    var layerResults = blended.map(function (b, i) {
      var L = b.L;
      var mFinal = smoothed[i];
      var layerEst = mFinal * L.count * CONFIG.CALIBRATION_FACTOR;
      total += layerEst;
      // 分层方差: 二项方差 (按有效样本量)
      variance += L.count * L.count * mFinal * (1 - mFinal) / b.w;

      return {
        layer_id: L.id,
        label: L.label,
        known_estimate: Math.round(layerEst),
        total: L.count,
        percent: L.count > 0 ? (mFinal * 100) : 0,
        asked_count: b.act.asked,
        correct_count: Math.round(b.act.correct * 10) / 10,
        actual_accuracy: b.act.asked > 0 ? Math.round(b.act.correct / b.act.asked * 100) : null
      };
    });

    var seTheta = standardError(session.responses, theta);
    if (!isFinite(seTheta)) seTheta = 0;

    var calibrated = total * CONFIG.CALIBRATION_FACTOR;
    var sd = Math.sqrt(variance) * CONFIG.CALIBRATION_FACTOR;
    var ciLower = Math.max(0, calibrated - CONFIG.Z_95 * sd);
    var ciUpper = calibrated + CONFIG.Z_95 * sd;

    var fpr = session.pseudoTotal > 0 ? (session.pseudoMarkedKnown / session.pseudoTotal) : 0;
    var reliable = fpr <= CONFIG.FPR_THRESHOLD;

    // 靶向模式: 结果为课标掌握度; 标准模式: 词汇量等级
    var level, masteryPct = null, curriculumTotal = null;
    if (processed.isCurriculum) {
      curriculumTotal = processed.realWords.length;
      masteryPct = calibrated / curriculumTotal * 100;
      level = getMasteryLevel(masteryPct);
    } else {
      level = getLevelLabel(calibrated);
    }

    // 不认识词列表 (逐词扫描报告): 答错/明确不认识的真实词
    var unknownWords = [];
    session.answerLog.forEach(function (a) {
      if (a.is_pseudo || a.u === 1) return;
      // 从 word 表查释义与册别
      var w = null;
      for (var i = 0; i < processed.realWords.length; i++) {
        if (processed.realWords[i].surface_form === a.word) { w = processed.realWords[i]; break; }
      }
      if (!w) return;
      unknownWords.push({
        word: a.word,
        meaning: w.meaning || "",
        grade: w.grade || null,
        layerLabel: layerLabelOf(processed, w.layer_id)
      });
    });

    return {
      mode: processed.isCurriculum ? "targeted" : "standard",
      theta: theta,
      seTheta: seTheta,
      vocabSize: Math.round(calibrated),
      ciLower: Math.round(ciLower),
      ciUpper: Math.round(ciUpper),
      layers: layerResults,
      masteryPct: masteryPct != null ? Math.round(masteryPct * 10) / 10 : null,
      curriculumTotal: curriculumTotal,
      unknownWords: unknownWords,
      fpr: fpr,
      pseudoMarked: session.pseudoMarkedKnown,
      pseudoTotal: session.pseudoTotal,
      reliable: reliable,
      level: level,
      questionCount: session.questionNumber,
      duration: Math.round((Date.now() - session.startTime) / 1000)
    };
  }

  function layerLabelOf(processed, layerId) {
    for (var i = 0; i < processed.layers.length; i++) {
      if (processed.layers[i].id === layerId) return processed.layers[i].label;
    }
    return "";
  }

  // 课标掌握度等级
  function getMasteryLevel(pct) {
    if (pct < 50) return { name: "需系统复习", en: "Review", color: "#A04A40" };
    if (pct < 65) return { name: "待巩固", en: "Building", color: "#B86A4A" };
    if (pct < 80) return { name: "合格", en: "Pass", color: "#C97B5A" };
    if (pct < 90) return { name: "良好", en: "Good", color: "#D89B6E" };
    return { name: "优秀", en: "Excellent", color: "#4A6B3A" };
  }

  function getLevelLabel(vocab) {
    if (vocab < 500) return { name: "起步者", en: "Starter", color: "#C97B5A" };
    if (vocab < 1500) return { name: "初学者", en: "Beginner", color: "#D89B6E" };
    if (vocab < 3000) return { name: "初中水平", en: "Junior", color: "#E0A86E" };
    if (vocab < 5000) return { name: "高中水平", en: "Senior", color: "#D88A5A" };
    if (vocab < 8000) return { name: "四级水平", en: "CET-4", color: "#C97B5A" };
    if (vocab < 12000) return { name: "六级水平", en: "CET-6", color: "#B86A4A" };
    if (vocab < 18000) return { name: "考研/雅思", en: "Advanced", color: "#A85A3A" };
    return { name: "GRE/大神", en: "Master", color: "#964A2E" };
  }

  return {
    CONFIG: CONFIG,
    LAYER_RANGES: LAYER_RANGES,
    QTYPE_KNOW: QTYPE_KNOW,
    QTYPE_MEANING: QTYPE_MEANING,
    QTYPE_SYN: QTYPE_SYN,
    preprocessLexicon: preprocessLexicon,
    createTestSession: createTestSession,
    selectNextWord: selectNextWord,
    recordAnswer: recordAnswer,
    isTestFinished: isTestFinished,
    computeFinalResult: computeFinalResult,
    estimateTheta: estimateTheta,
    shrinkTheta: shrinkTheta,
    standardError: standardError,
    sigmoid: sigmoid,
    getLevelLabel: getLevelLabel,
    buildMeaningOptions: buildMeaningOptions,
    buildSynOptions: buildSynOptions,
    getSessionAskedIds: getSessionAskedIds
  };
});
