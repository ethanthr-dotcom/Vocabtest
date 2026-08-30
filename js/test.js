// 测试页逻辑 (交叉测试: 认识/不认识 + 释义选择)
(function () {
  "use strict";
  App.ALGO = VocabAlgorithm;

  var ENCOURAGE = ["不错哦!", "继续加油~", "保持节奏", "稳住,你能行", "认真作答,结果更准"];
  var session = null;
  var processed = null;
  var wordStartTs = 0;
  // URL 参数: mode=standard, count=50|120 (靶向词表仅用于算法校准, 不暴露于界面)
  var params = new URLSearchParams(location.search);
  var mode = "standard";
  var maxQ = parseInt(params.get("count"), 10) || VocabAlgorithm.CONFIG.TOTAL_QUESTIONS;

  var elWord = document.getElementById("word");
  var elProgress = document.getElementById("progressFill");
  var elQNum = document.getElementById("qNum");
  document.getElementById("qTotal").textContent = maxQ;
  var elHint = document.getElementById("thetaHint");
  var elEncourage = document.getElementById("encourage");
  var elQTypeHint = document.getElementById("qTypeHint");
  var knowBtns = document.getElementById("knowButtons");
  var meaningBtns = document.getElementById("meaningButtons");
  var btnYes = document.getElementById("btnYes");
  var btnNo = document.getElementById("btnNo");

  function lock() {
    btnYes.disabled = true;
    btnNo.disabled = true;
    meaningBtns.style.pointerEvents = "none";
    meaningBtns.style.opacity = "0.5";
  }
  function unlock() {
    btnYes.disabled = false;
    btnNo.disabled = false;
    meaningBtns.style.pointerEvents = "";
    meaningBtns.style.opacity = "";
  }

  function next() {
    if (VocabAlgorithm.isTestFinished(session)) { finish(); return; }
    var q = VocabAlgorithm.selectNextWord(session, processed);
    if (!q) { finish(); return; }
    session.currentQuestion = q;
    wordStartTs = performance.now();

    elWord.classList.remove("pop");
    void elWord.offsetWidth;
    elWord.textContent = q.surface_form;
    elWord.classList.add("pop");

    elQNum.textContent = session.questionNumber + 1;
    elProgress.style.width = ((session.questionNumber / maxQ) * 100) + "%";
    elHint.textContent = session.questionNumber < 5 ? "正在定位水平…" : "自适应调整中…";

    var isChoice = (q.qtype === VocabAlgorithm.QTYPE_MEANING || q.qtype === VocabAlgorithm.QTYPE_SYN);
    if (isChoice) {
      // 释义题 / 近义反义题: 使用题目自带提示文案
      elQTypeHint.textContent = q.prompt || "下面哪个是这个词的正确释义?";
      knowBtns.classList.add("hidden");
      meaningBtns.classList.remove("hidden");
      renderMeaningOptions(q);
    } else {
      elQTypeHint.textContent = "你认识这个词吗?";
      knowBtns.classList.remove("hidden");
      meaningBtns.classList.add("hidden");
    }
    unlock();
  }

  function renderMeaningOptions(q) {
    meaningBtns.innerHTML = "";
    q.options.forEach(function (opt, i) {
      var b = document.createElement("button");
      // "不认识"选项使用特殊样式
      if (opt === "不认识") {
        b.className = "btn meaning-option meaning-unknown";
      } else {
        b.className = "btn meaning-option";
      }
      b.textContent = opt;
      b.addEventListener("click", function () {
        var correct = (i === q.correctIndex);
        // 点"不认识"按钮是明确不认识信号 (区别于猜错)
        var explicitUnknown = (opt === "不认识");
        flashOption(b, correct);
        answerMeaning(correct, explicitUnknown);
      });
      meaningBtns.appendChild(b);
    });
  }

  function flashOption(btn, correct) {
    lock();
    if (correct) {
      btn.classList.add("opt-correct");
    } else {
      btn.classList.add("opt-wrong");
      // 高亮正确答案
      var kids = meaningBtns.children;
      Array.prototype.forEach.call(kids, function (k) {
        if (k !== btn && k.textContent === session.currentQuestion.options[session.currentQuestion.correctIndex]) {
          k.classList.add("opt-correct");
        }
      });
    }
  }

  function answer(known) {
    lock();
    var rt = performance.now() - wordStartTs;
    VocabAlgorithm.recordAnswer(session, processed, known, rt);
    maybeEncourage();
    setTimeout(next, 250);
  }

  function answerMeaning(correct, explicitUnknown) {
    var rt = performance.now() - wordStartTs;
    VocabAlgorithm.recordAnswer(session, processed, correct ? 1 : 0, rt, explicitUnknown);
    maybeEncourage();
    setTimeout(next, 600);
  }

  function maybeEncourage() {
    if (session.questionNumber % 5 === 0 && session.questionNumber > 0) {
      elEncourage.textContent = ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)];
    }
  }

  function finish() {
    var result = VocabAlgorithm.computeFinalResult(session, processed);
    Storage.saveResult(result);
    // 保存本次测试问过的 word id, 供下次测试排除 (实现"每次不重复")
    var askedArr = VocabAlgorithm.getSessionAskedIds(session);
    Storage.saveAskedIds(askedArr);
    elProgress.style.width = "100%";
    elQNum.textContent = session.questionNumber;
    setTimeout(function () { location.href = "result.html"; }, 400);
  }

  btnYes.addEventListener("click", function () { answer(true); });
  btnNo.addEventListener("click", function () { answer(false); });

  document.addEventListener("keydown", function (e) {
    var qt = session && session.currentQuestion ? session.currentQuestion.qtype : null;
    if (qt === VocabAlgorithm.QTYPE_MEANING || qt === VocabAlgorithm.QTYPE_SYN) {
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= 5 && !meaningBtns.classList.contains("hidden") && meaningBtns.style.pointerEvents !== "none") {
        var kids = meaningBtns.children;
        if (kids[n - 1]) kids[n - 1].click();
      }
    } else {
      if (e.key === "ArrowLeft") { if (!btnNo.disabled) answer(false); }
      if (e.key === "ArrowRight") { if (!btnYes.disabled) answer(true); }
    }
  });

  App.loadLexicon(function (p) {
    if (!p) { elWord.textContent = "词库加载失败"; return; }
    processed = p;
    // 读取历史已问过的 word id, 作为本次测试的排除池 (实现"每次不重复")
    var prevAsked = Storage.getAskedIds();
    var excludeSet = prevAsked.length ? new Set(prevAsked) : null;
    session = VocabAlgorithm.createTestSession(processed, excludeSet, { totalQuestions: maxQ });
    next();
  }, mode);
})();
