// 本地存储工具 (小程序版, 可后续替换为云函数)
var HISTORY_KEY = 'vocab_history';
var LAST_KEY = 'last_result';
var ASKED_KEY = 'vocab_asked';

module.exports = {
  getHistory: function () {
    return wx.getStorageSync(HISTORY_KEY) || [];
  },
  saveResult: function (result) {
    var record = Object.assign({}, result, { ts: Date.now() });
    var list = this.getHistory();
    list.push(record);
    if (list.length > 30) list = list.slice(-30);
    wx.setStorageSync(HISTORY_KEY, list);
    wx.setStorageSync(LAST_KEY, record);
    return record;
  },
  getLast: function () {
    return wx.getStorageSync(LAST_KEY) || null;
  },
  // 跨测试去重: 保存/读取已问过的 word id 列表
  getAskedIds: function () {
    return wx.getStorageSync(ASKED_KEY) || [];
  },
  saveAskedIds: function (ids) {
    var existing = this.getAskedIds();
    var merged = existing.concat(ids);
    if (merged.length > 500) merged = merged.slice(-500);
    wx.setStorageSync(ASKED_KEY, merged);
  },
  clearAskedIds: function () {
    wx.removeStorageSync(ASKED_KEY);
  },
  formatDate: function (ts) {
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
};
