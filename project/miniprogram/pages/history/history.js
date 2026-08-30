// pages/history/history.js
var storage = require('../../utils/storage.js');

Page({
  data: {
    history: [],
    values: []
  },

  onLoad: function () { this.loadHistory(); },
  onShow: function () { this.loadHistory(); },

  loadHistory: function () {
    var raw = storage.getHistory();
    var list = raw.slice().reverse().map(function (r) {
      return {
        ts: r.ts,
        dateText: storage.formatDate(r.ts),
        levelName: r.level ? r.level.name : '',
        vocabSize: r.vocabSize
      };
    });
    var values = raw.map(function (r) { return r.vocabSize; });
    this.setData({ history: list, values: values });
    this.drawChart(values);
  },

  drawChart: function (values) {
    var ctx = wx.createCanvasContext('chart');
    var W = 650, H = 360, PAD = 50;
    if (values.length < 2) {
      ctx.setFontSize(13);
      ctx.setFillStyle('#8B7355');
      ctx.setTextAlign('center');
      ctx.fillText('至少需要 2 次测试才能显示趋势', W / 2, H / 2);
      ctx.draw();
      return;
    }
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if (max === min) max = min + 1;
    var n = values.length;

    function x(i) { return PAD + (i / (n - 1)) * (W - 2 * PAD); }
    function y(v) { return H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD); }

    // 网格线
    for (var g = 0; g <= 4; g++) {
      var gy = PAD + (g / 4) * (H - 2 * PAD);
      var gv = Math.round(max - (g / 4) * (max - min));
      ctx.setStrokeStyle('#E8E0D5');
      ctx.setLineDash([6, 6], 0);
      ctx.beginPath();
      ctx.moveTo(PAD, gy);
      ctx.lineTo(W - PAD, gy);
      ctx.stroke();
      ctx.setFillStyle('#8B7355');
      ctx.setFontSize(11);
      ctx.setTextAlign('right');
      ctx.fillText('' + gv, PAD - 6, gy + 4);
    }
    ctx.setLineDash([], 0);

    // 面积
    ctx.beginPath();
    values.forEach(function (v, i) {
      var px = x(i), py = y(v);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.lineTo(x(n - 1), H - PAD);
    ctx.lineTo(x(0), H - PAD);
    ctx.closePath();
    ctx.setFillStyle('rgba(201,123,90,0.18)');
    ctx.fill();

    // 折线
    ctx.beginPath();
    values.forEach(function (v, i) {
      var px = x(i), py = y(v);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.setStrokeStyle('#C97B5A');
    ctx.setLineWidth(2.5);
    ctx.setLineCap('round');
    ctx.setLineJoin('round');
    ctx.stroke();

    // 点
    values.forEach(function (v, i) {
      ctx.beginPath();
      ctx.arc(x(i), y(v), 4, 0, 2 * Math.PI);
      ctx.setFillStyle('#C97B5A');
      ctx.fill();
      ctx.setStrokeStyle('#fff');
      ctx.setLineWidth(2);
      ctx.stroke();
    });

    ctx.draw();
  }
});
