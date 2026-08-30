// pages/result/result.js
var storage = require('../../utils/storage.js');

Page({
  data: {
    result: null,
    displayNum: 0,
    fprPct: 0,
    logoMissing: false,
    cardReady: false,
    cardName: ''
  },

  onLoad: function () {
    var result = storage.getLast();
    if (!result) {
      wx.redirectTo({ url: '/pages/home/home' });
      return;
    }
    var layers = result.layers.map(function (L) {
      return Object.assign({}, L, { percentPct: Math.round(L.percent) });
    });
    var finalResult = Object.assign({}, result, {
      layers: layers,
      unknownWords: result.unknownWords || []
    });
    this.setData({
      result: finalResult,
      fprPct: Math.round(result.fpr * 100),
      cardName: (function () {
        try { return wx.getStorageSync('vocab_name') || ''; } catch (e) { return ''; }
      })()
    });
    this.animateNumber(result.vocabSize);
  },

  animateNumber: function (target) {
    var self = this;
    var startTime = Date.now();
    var duration = 1200;
    function tick() {
      var t = Math.min(1, (Date.now() - startTime) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      var val = Math.round(target * eased);
      self.setData({ displayNum: val });
      if (t < 1) setTimeout(tick, 16);
      else self.setData({ displayNum: target });
    }
    tick();
  },

  onLogoError: function () { this.setData({ logoMissing: true }); },

  goTest: function () {
    var r = this.data.result;
    var count = r && r.questionCount >= 100 ? 120 : 50;
    wx.redirectTo({ url: '/pages/test/test?mode=standard&count=' + count });
  },

  // 生成分享卡片
  makeCard: function () {
    var self = this;
    this.setData({ cardReady: true }, function () {
      setTimeout(function () { self.drawCard(); }, 100);
    });
  },

  drawCard: function () {
    var self = this;
    var r = this.data.result;
    var ctx = wx.createCanvasContext('shareCard');
    var W = 300, H = 400; // canvas 逻辑尺寸 (rpx 600x800 / 2)
    // 卡片署名: 优先用户设置, 回退微信昵称, 最后 "我"
    var name = this.data.cardName || '';
    if (!name) {
      try { name = wx.getStorageSync('vocab_name') || ''; } catch (e) {}
    }
    if (!name) {
      var ui = wx.getSystemInfoSync();
      // 微信昵称不可直接获取, 使用存储或默认
      name = '';
    }
    if (!name) name = '我';
    if (name.length > 8) name = name.slice(0, 8);

    // 背景
    ctx.setFillStyle('#FAF9F5');
    ctx.fillRect(0, 0, W, H);
    // ===== 顶部品牌区 =====
    var grad = ctx.createLinearGradient(0, 0, W, 150);
    grad.addColorStop(0, '#E0A86E');
    grad.addColorStop(1, '#C97B5A');
    ctx.setFillStyle(grad);
    roundRect(ctx, 16, 16, W - 32, 130, 18);
    ctx.fill();
    // Logo V
    roundRect(ctx, 36, 42, 76, 76, 16);
    ctx.setFillStyle('#FFFFFF');
    ctx.fill();
    ctx.setFillStyle('#C97B5A');
    ctx.setFontSize(44);
    ctx.setTextAlign('center');
    ctx.setTextBaseline('middle');
    ctx.fillText('V', 74, 81);
    // 品牌名
    ctx.setTextAlign('left');
    ctx.setFillStyle('#FFFFFF');
    ctx.setFontSize(24);
    ctx.fillText('词汇量测试', 130, 70);
    ctx.setFontSize(12);
    ctx.setFillStyle('rgba(255,255,255,0.92)');
    ctx.fillText('Vocabulary Test', 132, 100);

    // ===== 中部: 姓名 + 成绩 =====
    ctx.setTextAlign('center');
    ctx.setFillStyle('#8B7355');
    ctx.setFontSize(15);
    ctx.fillText(name + ' 的英语词汇量', W / 2, 186);
    // 大数字 (自适应字号防溢出)
    var numStr = String(r.vocabSize);
    ctx.setFillStyle('#C97B5A');
    ctx.setFontSize(numStr.length >= 6 ? 60 : (numStr.length === 5 ? 68 : 76));
    ctx.fillText(numStr, W / 2, 240);
    // 单位
    ctx.setFillStyle('#8B7355');
    ctx.setFontSize(14);
    ctx.fillText('个词', W / 2, 282);

    // ===== 日期 =====
    ctx.setFillStyle('#6B5D55');
    ctx.setFontSize(12);
    ctx.fillText(storage.formatDate(r.ts), W / 2, 314);

    // ===== 底部宣传语色带 =====
    var grad2 = ctx.createLinearGradient(0, 338, W, 384);
    grad2.addColorStop(0, '#F5E8DD');
    grad2.addColorStop(1, '#F0DFD0');
    ctx.setFillStyle(grad2);
    roundRect(ctx, 16, 338, W - 32, 46, 16);
    ctx.fill();
    ctx.setFillStyle('#C97B5A');
    ctx.setFontSize(14);
    ctx.fillText('来测测你的词汇量吧 ~', W / 2, 361);

    ctx.draw(false, function () {
      setTimeout(function () {
        wx.canvasToTempFilePath({
          canvasId: 'shareCard',
          success: function (res) {
            self.setData({ shareImgPath: res.tempFilePath });
          },
          fail: function () {}
        });
      }, 300);
    });
  },

  // 输入卡片署名
  onNameInput: function (e) {
    this.setData({ cardName: e.detail.value });
    try { wx.setStorageSync('vocab_name', e.detail.value); } catch (err) {}
  },

  saveAlbum: function () {
    var self = this;
    if (!this.data.shareImgPath) {
      wx.showToast({ title: '正在生成…', icon: 'loading' });
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath: this.data.shareImgPath,
      success: function () { wx.showToast({ title: '已保存到相册', icon: 'success' }); },
      fail: function (err) {
        if (/auth/.test(err.errMsg || '')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存到相册',
            success: function (r) { if (r.confirm) wx.openSetting(); }
          });
        }
      }
    });
  },

  onShareAppMessage: function () {
    var r = this.data.result;
    return {
      title: '我的英语词汇量约 ' + r.vocabSize + ' 词' +
        (r.level ? ' (' + r.level.name + ')' : '') + ' · 来测测你的吧!',
      path: '/pages/home/home',
      imageUrl: this.data.shareImgPath || ''
    };
  },

  onShareTimeline: function () {
    var r = this.data.result;
    return {
      title: '我的英语词汇量约 ' + r.vocabSize + ' 词,来测测你的吧!'
    };
  }
});

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
