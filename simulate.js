// ===== 算法校准 (v3): 散在型知识画像 + 分层实测估计 =====
// 真实用户画像: 中国学生对每个词频层都有部分认识 (abandon 效应), 不是干净的前N词截断
var A = require('./project/web/js/algorithm.js');
var data = require('./project/web/data/lexicon.json');
var pStd = A.preprocessLexicon(data);

// 散在型画像: 每层掌握率 (校准目标: 总认识词数 ≈ 5000)
// 层词数: L1:1000 L2:1000 L3:1000 L4:2000 L5:5000 L6:10000 L7:2355
var PROFILES = {
  '5000词 (用户)': { 1: 0.97, 2: 0.93, 3: 0.82, 4: 0.55, 5: 0.16, 6: 0.04, 7: 0.01 },
  '3000词 (课标)': { 1: 0.96, 2: 0.85, 3: 0.55, 4: 0.22, 5: 0.05, 6: 0.01, 7: 0.002 },
  '8000词 (超纲)': { 1: 0.99, 2: 0.98, 3: 0.95, 4: 0.85, 5: 0.45, 6: 0.15, 7: 0.04 }
};

function profileTruth(p) {
  var t = 0;
  pStd.layers.forEach(function (L) {
    t += (p[L.id] || 0) * L.count;
  });
  return Math.round(t);
}

function simulate(profile, n) {
  var session = A.createTestSession(pStd, null, { totalQuestions: n });
  while (!A.isTestFinished(session)) {
    var q = A.selectNextWord(session, pStd);
    if (!q) break;
    session.currentQuestion = q;
    var known, explicitUnknown = false;
    if (q.is_pseudo) {
      known = Math.random() < 0.15 ? 1 : 0;
    } else {
      var m = profile[q.word.layer_id] || 0;
      if (q.qtype === 'know') {
        // 认识则答认识; 不认识 40% "眼熟就算认识"
        known = Math.random() < m ? 1 : (Math.random() < 0.4 ? 1 : 0);
      } else if (Math.random() < m) {
        // 认识的词: 92% 答对
        known = Math.random() < 0.92 ? 1 : 0;
      } else if (Math.random() < 0.4) {
        // 不认识: 乱猜 (25% 命中)
        known = Math.random() < 0.25 ? 1 : 0;
      } else {
        known = 0; explicitUnknown = true;
      }
    }
    A.recordAnswer(session, pStd, known, 1000, explicitUnknown);
  }
  return A.computeFinalResult(session, pStd);
}

Object.keys(PROFILES).forEach(function (name) {
  var p = PROFILES[name];
  var truth = profileTruth(p);
  console.log('\n--- ' + name + ' (真实认识 ' + truth + ' 词) ---');
  [50, 120].forEach(function (n) {
    var sum = 0;
    for (var t = 0; t < 20; t++) sum += simulate(p, n).vocabSize;
    var est = Math.round(sum / 20);
    console.log('  ' + n + '题x20: 估计 ' + est + ' (比率 ' + (est / truth).toFixed(2) + 'x)');
  });
});
