// 历史页逻辑
(function () {
  "use strict";
  App.ALGO = VocabAlgorithm;
  App.setActiveNav("history");

  var history = Storage.getHistory();

  var listEl = document.getElementById("list");
  if (!history.length) {
    listEl.innerHTML = '<li class="history-empty">还没有测试记录,<a href="test.html">开始第一次测试</a>吧~</li>';
  } else {
    // 倒序显示 (最新在前)
    history.slice().reverse().forEach(function (r) {
      var li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML =
        '<span class="h-date">' + App.formatDate(r.ts) +
          (r.level ? " · " + r.level.name : "") + "</span>" +
        '<span class="h-val">' + r.vocabSize.toLocaleString() + " 词</span>";
      listEl.appendChild(li);
    });
  }

  // 趋势折线图 (SVG)
  var svg = document.getElementById("chart");
  if (history.length < 2) {
    svg.innerHTML = '<text x="360" y="100" text-anchor="middle" fill="#8B7355" font-size="14">至少需要 2 次测试才能显示趋势</text>';
    return;
  }

  var W = 720, H = 200, PAD = 30;
  var values = history.map(function (r) { return r.vocabSize; });
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  if (max === min) { max = min + 1; }
  var n = values.length;

  function x(i) { return PAD + (i / (n - 1)) * (W - 2 * PAD); }
  function y(v) { return H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD); }

  var pathD = "";
  values.forEach(function (v, i) {
    pathD += (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(v).toFixed(1) + " ";
  });

  var svgStr = "";
  // 网格线
  for (var g = 0; g <= 4; g++) {
    var gy = PAD + (g / 4) * (H - 2 * PAD);
    var gv = max - (g / 4) * (max - min);
    svgStr += '<line x1="' + PAD + '" y1="' + gy + '" x2="' + (W - PAD) + '" y2="' + gy +
      '" stroke="#E8E0D5" stroke-width="1" stroke-dasharray="3 3"/>';
    svgStr += '<text x="' + (PAD - 6) + '" y="' + (gy + 4) + '" text-anchor="end" fill="#8B7355" font-size="11">' + Math.round(gv) + "</text>";
  }
  // 渐变面积
  pathD += "L" + x(n - 1).toFixed(1) + " " + (H - PAD) + " L" + x(0).toFixed(1) + " " + (H - PAD) + " Z";
  svgStr += '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C97B5A" stop-opacity="0.35"/><stop offset="1" stop-color="#C97B5A" stop-opacity="0"/></linearGradient></defs>';
  svgStr += '<path d="' + pathD + '" fill="url(#ag)"/>';

  // 折线 (重新构造不包含底部)
  var lineD = "";
  values.forEach(function (v, i) {
    lineD += (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(v).toFixed(1) + " ";
  });
  svgStr += '<path d="' + lineD + '" fill="none" stroke="#C97B5A" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

  // 点
  values.forEach(function (v, i) {
    svgStr += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="4" fill="#C97B5A" stroke="#fff" stroke-width="2"/>';
  });
  svg.innerHTML = svgStr;
})();
