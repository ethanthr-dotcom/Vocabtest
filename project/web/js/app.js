// 本地存储 / 词库加载 / 公共逻辑 (网站版)
// 小程序版会改写为 wx.getStorageSync / wx.request
(function (root) {
  "use strict";

  var HISTORY_KEY = "vocabtest_history_v1";
  var LAST_KEY = "vocabtest_last_v1";
  var ASKED_KEY = "vocabtest_asked_v1";

  var Storage = {
    getHistory: function () {
      try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      } catch (e) { return []; }
    },
    saveResult: function (result) {
      var record = Object.assign({}, result, { ts: Date.now() });
      var list = Storage.getHistory();
      list.push(record);
      // 只保留最近 30 条
      if (list.length > 30) list = list.slice(-30);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      localStorage.setItem(LAST_KEY, JSON.stringify(record));
      return record;
    },
    getLast: function () {
      try {
        return JSON.parse(localStorage.getItem(LAST_KEY) || "null");
      } catch (e) { return null; }
    },
    // 跨测试去重: 保存/读取已问过的 word id 列表
    getAskedIds: function () {
      try {
        return JSON.parse(localStorage.getItem(ASKED_KEY) || "[]");
      } catch (e) { return []; }
    },
    saveAskedIds: function (ids) {
      var existing = Storage.getAskedIds();
      var merged = existing.concat(ids);
      // 只保留最近 500 个, 避免无限增长
      if (merged.length > 500) merged = merged.slice(-500);
      localStorage.setItem(ASKED_KEY, JSON.stringify(merged));
    },
    clearAskedIds: function () {
      localStorage.removeItem(ASKED_KEY);
    }
  };

  var App = {
    ALGO: null,            // VocabAlgorithm
    processedLexicon: null,
    rawLexicon: null,

    // mode: 'standard' (全词库) | 'targeted' (课标靶向)
    loadLexicon: function (cb, mode) {
      var url = mode === "targeted" ? "data/curriculum.json" : "data/lexicon.json";
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          App.rawLexicon = data;
          App.processedLexicon = App.ALGO.preprocessLexicon(data);
          cb && cb(App.processedLexicon);
        })
        .catch(function (err) {
          console.error("词库加载失败", err);
          cb && cb(null);
        });
    },

    formatDate: function (ts) {
      var d = new Date(ts);
      var pad = function (n) { return n < 10 ? "0" + n : n; };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
        " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    },

    setActiveNav: function (page) {
      var links = document.querySelectorAll(".navbar nav a");
      links.forEach(function (a) {
        if (a.getAttribute("data-page") === page) a.classList.add("active");
        else a.classList.remove("active");
      });
    }
  };

  root.Storage = Storage;
  root.App = App;
})(window);
