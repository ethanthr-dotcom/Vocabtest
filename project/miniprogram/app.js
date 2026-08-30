// app.js
var A = require('./utils/algorithm.js');

App({
  globalData: {
    algo: A,
    processedLexicon: null,
    lastResult: null
  },
  onLaunch: function () {
    var raw = require('./data/lexicon.js');
    this.globalData.processedLexicon = A.preprocessLexicon(raw);
    this.globalData.lastResult = wx.getStorageSync('last_result') || null;
  }
});
