// pages/test/test.js
var A = require('../../utils/algorithm.js');
var storage = require('../../utils/storage.js');

var ENCOURAGE = ['不错哦!', '继续加油~', '保持节奏', '稳住,你能行', '认真作答,结果更准'];

Page({
  data: {
    word: '…',
    wordAnim: 'pop',
    qNum: 0,
    progressPct: 0,
    hint: '正在定位水平…',
    encourage: '',
    qtype: 'know',
    qTypeHint: '你认识这个词吗?',
    options: [],
    correctIdx: -1,
    selectedIdx: -1,
    locked: false
  },

  onLoad: function (options) {
    // options: count=50|120 (靶向词表仅用于算法校准, 不暴露于界面)
    var count = options && parseInt(options.count, 10) || A.CONFIG.TOTAL_QUESTIONS;
    var app = getApp();
    this.processed = app.globalData.processedLexicon;
    if (!this.processed) {
      var raw = require('../../data/lexicon.js');
      this.processed = A.preprocessLexicon(raw);
    }
    // 读取历史已问过的 word id, 作为本次测试的排除池 (实现"每次不重复")
    var prevAsked = storage.getAskedIds();
    var excludeSet = prevAsked.length ? new Set(prevAsked) : null;
    this.session = A.createTestSession(this.processed, excludeSet, { totalQuestions: count });
    this.maxQ = count;
    this.wordStartTs = 0;
    this.next();
  },

  next: function () {
    if (A.isTestFinished(this.session)) { this.finish(); return; }
    var q = A.selectNextWord(this.session, this.processed);
    if (!q) { this.finish(); return; }
    this.session.currentQuestion = q;
    this.wordStartTs = Date.now();

    var qNum = this.session.questionNumber + 1;
    var pct = Math.round((this.session.questionNumber / this.maxQ) * 100);
    var hint = this.session.questionNumber < 5 ? '正在定位水平…' : '自适应调整中…';
    // 选择题 (释义/近义反义) 使用题目自带提示文案
    var isChoice = (q.qtype === A.QTYPE_MEANING || q.qtype === A.QTYPE_SYN);
    var qTypeHint = isChoice
      ? (q.prompt || '下面哪个是这个词的正确释义?')
      : '你认识这个词吗?';

    var self = this;
    var payload = {
      word: q.surface_form,
      wordAnim: '',
      qNum: qNum,
      totalQ: this.maxQ,
      progressPct: pct,
      hint: hint,
      qtype: q.qtype,
      qTypeHint: qTypeHint,
      options: isChoice ? q.options : [],
      correctIdx: isChoice ? q.correctIndex : -1,
      selectedIdx: -1,
      locked: false
    };
    this.setData(payload, function () {
      self.setData({ wordAnim: 'pop' });
    });
  },

  answer: function (e) {
    if (this.data.locked) return;
    var known = e.currentTarget.dataset.known === '1';
    var rt = Date.now() - this.wordStartTs;
    this.setData({ locked: true });
    A.recordAnswer(this.session, this.processed, known ? 1 : 0, rt);
    this.maybeEncourage();
    var self = this;
    setTimeout(function () { self.next(); }, 200);
  },

  answerMeaning: function (e) {
    if (this.data.locked) return;
    var idx = e.currentTarget.dataset.index;
    var correct = (idx === this.data.correctIdx);
    // 点"不认识"按钮是明确不认识信号 (区别于猜错)
    var explicitUnknown = (this.data.options[idx] === '不认识');
    this.setData({ selectedIdx: idx, locked: true });
    var rt = Date.now() - this.wordStartTs;
    A.recordAnswer(this.session, this.processed, correct ? 1 : 0, rt, explicitUnknown);
    this.maybeEncourage();
    var self = this;
    setTimeout(function () { self.next(); }, 650);
  },

  maybeEncourage: function () {
    if (this.session.questionNumber % 5 === 0 && this.session.questionNumber > 0) {
      this.setData({ encourage: ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)] });
    }
  },

  finish: function () {
    var result = A.computeFinalResult(this.session, this.processed);
    storage.saveResult(result);
    // 保存本次测试问过的 word id, 供下次测试排除 (实现"每次不重复")
    var askedArr = A.getSessionAskedIds(this.session);
    storage.saveAskedIds(askedArr);
    var self = this;
    this.setData({ progressPct: 100, qNum: this.session.questionNumber }, function () {
      setTimeout(function () {
        wx.redirectTo({ url: '/pages/result/result' });
      }, 400);
    });
  }
});
