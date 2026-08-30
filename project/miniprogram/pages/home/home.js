// pages/home/home.js
var storage = require('../../utils/storage.js');

Page({
  data: {
    lastResult: null,
    lastDateText: '',
    logoMissing: false
  },
  onShow: function () {
    var last = storage.getLast();
    if (last) {
      this.setData({
        lastResult: last,
        lastDateText: storage.formatDate(last.ts)
      });
    } else {
      this.setData({ lastResult: null });
    }
  },
  onLogoError: function () {
    this.setData({ logoMissing: true });
  },
  goQuick: function () {
    wx.navigateTo({ url: '/pages/test/test?mode=standard&count=50' });
  },
  goPrecise: function () {
    wx.navigateTo({ url: '/pages/test/test?mode=standard&count=120' });
  }
});
