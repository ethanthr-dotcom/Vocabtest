// 结果页逻辑
(function () {
  "use strict";
  App.ALGO = VocabAlgorithm;
  App.setActiveNav("home");

  var result = Storage.getLast();
  if (!result) {
    location.href = "index.html";
    return;
  }

  // 滚动数字
  function animateNumber(el, target, duration) {
    var start = 0;
    var startTime = performance.now();
    function tick(now) {
      var t = Math.min(1, (now - startTime) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(start + (target - start) * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // 再测链接: 与本次测试题数一致
  document.getElementById("retestBtn").href =
    "test.html?mode=standard&count=" + (result.questionCount >= 100 ? 120 : 50);

  // 卡片署名: 回填上次姓名
  try {
    var savedName = localStorage.getItem("vocabtest_name");
    if (savedName) document.getElementById("nameInput").value = savedName;
  } catch (e) {}

  animateNumber(document.getElementById("bigNum"), result.vocabSize, 1200);

  document.getElementById("ci").textContent =
    "95% 置信区间: " + result.ciLower.toLocaleString() + " ~ " + result.ciUpper.toLocaleString();

  // SE 稳定性说明 (SE < 0.3 非常稳定 / 0.3-0.4 较稳定 / 0.4-0.5 有参考价值 / >0.5 粗略估计)
  if (result.seTheta != null && isFinite(result.seTheta)) {
    var seDesc;
    if (result.seTheta < 0.3) seDesc = "非常稳定";
    else if (result.seTheta < 0.4) seDesc = "较为稳定";
    else if (result.seTheta < 0.5) seDesc = "具有参考价值";
    else seDesc = "粗略估计";
    var ciEl = document.getElementById("ci");
    ciEl.textContent += " · 估计稳定性: " + seDesc + " (SE=" + result.seTheta.toFixed(2) + ")";
  }

  if (result.level) {
    var badge = document.getElementById("levelBadge");
    badge.textContent = result.level.name + " · " + result.level.en;
    badge.style.background = result.level.color + "22";
    badge.style.color = result.level.color;
    badge.classList.remove("hidden");
  }

  // 假词警告
  if (!result.reliable) {
    var warn = document.getElementById("warn");
    warn.textContent = "⚠️ 检测到较多不确定作答(假词误报率 " +
      Math.round(result.fpr * 100) + "%),结果可能偏高,建议重新测试。";
    warn.classList.remove("hidden");
  }

  // 各层条形图
  var layersEl = document.getElementById("layers");
  result.layers.forEach(function (L) {
    var row = document.createElement("div");
    row.className = "layer-bar";
    var label = document.createElement("div");
    label.className = "layer-label";
    // 显示实测作答 (诊断: 区分"算法虚高"还是"真的答对了")
    if (L.asked_count > 0) {
      label.textContent = L.label + " (实测 " + L.correct_count + "/" + L.asked_count + ")";
    } else {
      label.textContent = L.label;
    }
    var track = document.createElement("div");
    track.className = "layer-track";
    var fill = document.createElement("div");
    fill.className = "layer-fill";
    fill.style.width = "0%";
    track.appendChild(fill);
    var pct = document.createElement("div");
    pct.className = "layer-percent";
    pct.textContent = "0%";
    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(pct);
    layersEl.appendChild(row);
    // 动画
    setTimeout(function () {
      var p = Math.round(L.percent);
      fill.style.width = p + "%";
      pct.textContent = p + "%";
    }, 300);
  });

  // 不认识的词清单 (靶向模式逐词扫描报告)
  if (result.unknownWords && result.unknownWords.length) {
    var sec = document.getElementById("unknownSection");
    document.getElementById("unknownCount").textContent = result.unknownWords.length;
    var listEl = document.getElementById("unknownWords");
    result.unknownWords.forEach(function (u) {
      var item = document.createElement("div");
      item.className = "unknown-item";
      var w = document.createElement("div");
      w.className = "unknown-word";
      w.textContent = u.word;
      var m = document.createElement("div");
      m.className = "unknown-meaning";
      m.textContent = u.meaning + (u.layerLabel ? " · " + u.layerLabel : "");
      item.appendChild(w);
      item.appendChild(m);
      listEl.appendChild(item);
    });
    sec.classList.remove("hidden");
  }

  // 生成分享卡片 (Canvas -> PNG)
  // 排版: 品牌标识 + 测试人姓名 + 成绩 + 日期 + 宣传语
  document.getElementById("shareBtn").addEventListener("click", function () {
    var canvas = document.getElementById("shareCanvas");
    // 记住姓名
    var nameInput = document.getElementById("nameInput");
    if (nameInput) {
      try { localStorage.setItem("vocabtest_name", nameInput.value.trim()); } catch (e) {}
    }
    drawShareCard(canvas, result);
    document.getElementById("cardWrap").classList.remove("hidden");
    var dl = document.getElementById("downloadLink");
    try { dl.href = canvas.toDataURL("image/png"); } catch (e) {}
    dl.scrollIntoView({ behavior: "smooth" });
  });

  function drawShareCard(canvas, r) {
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    var name = "";
    try { name = localStorage.getItem("vocabtest_name") || ""; } catch (e) {}
    if (!name) name = "我";
    // 文本截断: 最多 10 个字符
    if (name.length > 10) name = name.slice(0, 10);

    // 背景
    ctx.fillStyle = "#FAF9F5";
    ctx.fillRect(0, 0, W, H);

    // ===== 顶部品牌区: 渐变色块 =====
    var grad = ctx.createLinearGradient(0, 0, W, 380);
    grad.addColorStop(0, "#E0A86E");
    grad.addColorStop(1, "#C97B5A");
    ctx.fillStyle = grad;
    roundRect(ctx, 36, 36, W - 72, 320, 44);
    ctx.fill();

    // Logo 圆角方块 + V (左)
    roundRect(ctx, 90, 106, 180, 180, 40);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.fillStyle = "#C97B5A";
    ctx.font = "bold 104px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("V", 180, 198);

    // 品牌名 (logo 右侧)
    ctx.textAlign = "left";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 56px Georgia, 'Songti SC', serif";
    ctx.fillText("词汇量测试", 320, 172);
    ctx.font = "28px Georgia, 'Songti SC', serif";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText("Vocabulary Test", 322, 230);

    // ===== 中部: 姓名 + 成绩 =====
    ctx.textAlign = "center";
    // 姓名
    ctx.fillStyle = "#8B7355";
    ctx.font = "34px Georgia, 'Songti SC', serif";
    ctx.fillText(name + " 的英语词汇量", W / 2, 452);
    // 大数字 (自适应字号: 位数多则缩小, 严禁溢出)
    var numStr = String(r.vocabSize);
    var numSize = numStr.length >= 6 ? 150 : (numStr.length === 5 ? 170 : 190);
    ctx.fillStyle = "#C97B5A";
    ctx.font = "bold " + numSize + "px Georgia, serif";
    ctx.fillText(numStr, W / 2, 590);
    // 单位
    ctx.fillStyle = "#8B7355";
    ctx.font = "32px Georgia, 'Songti SC', serif";
    ctx.fillText("个词", W / 2, 668);

    // ===== 日期 =====
    ctx.fillStyle = "#6B5D55";
    ctx.font = "26px Georgia, 'Songti SC', serif";
    ctx.fillText(App.formatDate(r.ts), W / 2, 742);

    // ===== 底部宣传语色带 =====
    var grad2 = ctx.createLinearGradient(0, H - 150, W, H - 36);
    grad2.addColorStop(0, "#F5E8DD");
    grad2.addColorStop(1, "#F0DFD0");
    ctx.fillStyle = grad2;
    roundRect(ctx, 36, H - 150, W - 72, 114, 40);
    ctx.fill();
    ctx.fillStyle = "#C97B5A";
    ctx.font = "bold 34px Georgia, 'Songti SC', serif";
    ctx.textBaseline = "middle";
    ctx.fillText("来测测你的词汇量吧 ~", W / 2, H - 93);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
})();
