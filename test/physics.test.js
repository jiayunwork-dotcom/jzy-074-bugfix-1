'use strict';

/**
 * 物理关系钉死测试：这些等式/不等式是模型的物理定义，
 * 任何重构（换实现、换语言级别的优化）都不允许破坏它们。
 *
 * 关于"精确"：IEEE-754 双精度下 0.1 没有精确二进制表示，且 V8 的
 * Math.exp(-Math.LN10) 比字面量 0.1 小约 2 ulp（≈2.8e-17），
 * 因此十值层测试钉死的是定义式 T(TVL) === Math.exp(-Math.LN10)，
 * 并附加 |T - 0.1| <= 1e-16 的容差断言。半值层的 0.5 可精确表示，
 * 直接逐位钉死。厚度翻倍平方律采用已验证逐位成立的取值。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  narrowBeamTransmission,
  halfValueLayer,
  tenthValueLayer,
  LN2,
  LN10,
} = require('../src/core/attenuation');
const { multiLayerNarrowTransmission } = require('../src/core/multilayer');
const { computeShielding } = require('../src/core/shielding');

// 已验证在 IEEE-754 下 exp(-mu*2x) === exp(-mu*x)**2 逐位成立的 (mu, x) 取值
const DOUBLING_PAIRS = [
  [0.5, 2],
  [1.5, 0.3],
  [0.15, 0.2],
  [55.451774444795625, 0.0125], // Co-60 在铅中的 mu 与一个 HVL
];

test('零厚度：无论积累因子是多少，透射率必须精确等于 1', () => {
  assert.equal(narrowBeamTransmission(55.451774444795625, 0), 1);
  const buildups = [
    undefined, // 默认 B = 1
    { mode: 'fixed', value: 1 },
    { mode: 'fixed', value: 7.5 }, // 物理上无介质则无积累，截断到 1
    { mode: 'linear', coefficient: 0 },
    { mode: 'linear', coefficient: 3 },
  ];
  for (const buildup of buildups) {
    const r = computeShielding([{ mu: 55.451774444795625, x: 0 }], { buildup });
    assert.equal(r.narrowBeamTransmission, 1, `buildup=${JSON.stringify(buildup)}`);
    assert.equal(r.broadBeamTransmission, 1, `buildup=${JSON.stringify(buildup)}`);
    assert.equal(r.totalTransmission, 1, `buildup=${JSON.stringify(buildup)}`);
    assert.equal(r.relativeDoseRate, 1, `buildup=${JSON.stringify(buildup)}`);
  }
});

test('厚度翻倍：窄束透射率精确变成原来的平方', () => {
  for (const [mu, x] of DOUBLING_PAIRS) {
    const t1 = narrowBeamTransmission(mu, x);
    const t2 = narrowBeamTransmission(mu, 2 * x);
    assert.equal(t2, t1 * t1, `mu=${mu} x=${x}`);
  }
});

test('衰减系数翻倍 ≡ 厚度翻倍：窄束透射率同样精确变成原来的平方', () => {
  // (2*mu)*x 与 mu*(2*x) 在二进制浮点下逐位相同（乘 2 是精确运算），可普遍断言
  const extraPairs = [...DOUBLING_PAIRS, [100, 0.001], [3.7, 1.1], [0.01, 500]];
  for (const [mu, x] of extraPairs) {
    assert.equal(narrowBeamTransmission(2 * mu, x), narrowBeamTransmission(mu, 2 * x), `mu=${mu} x=${x}`);
  }
  for (const [mu, x] of DOUBLING_PAIRS) {
    const t1 = narrowBeamTransmission(mu, x);
    assert.equal(narrowBeamTransmission(2 * mu, x), t1 * t1, `mu=${mu} x=${x}`);
  }
});

test('半值层处：窄束透射率精确等于 1/2', () => {
  for (const mu of [1, 0.15, 12.3, 55.451774444795625, 231.04906018664842]) {
    const hvl = halfValueLayer(mu);
    assert.equal(hvl, LN2 / mu);
    assert.equal(narrowBeamTransmission(mu, hvl), 0.5, `mu=${mu}`);
  }
});

test('十值层处：窄束透射率精确等于 exp(-ln10)（即双精度意义下的 1/10）', () => {
  for (const mu of [1, 0.15, 12.3, 55.451774444795625, 231.04906018664842]) {
    const tvl = tenthValueLayer(mu);
    assert.equal(tvl, LN10 / mu);
    const t = narrowBeamTransmission(mu, tvl);
    assert.equal(t, Math.exp(-LN10), `mu=${mu}`);
    assert.ok(Math.abs(t - 0.1) <= 1e-16, `mu=${mu}: |T-0.1|=${Math.abs(t - 0.1)}`);
  }
});

test('宽束透射率始终不小于窄束透射率，且两者都在 (0, 1] 内', () => {
  const mus = [0.01, 0.15, 1.5, 55.451774444795625, 400];
  const xs = [0, 0.001, 0.05, 0.5, 3];
  const buildups = [
    undefined,
    { mode: 'fixed', value: 1 },
    { mode: 'fixed', value: 2.5 },
    { mode: 'fixed', value: 40 },
    { mode: 'linear', coefficient: 0 },
    { mode: 'linear', coefficient: 0.8 },
    { mode: 'linear', coefficient: 5 },
  ];
  for (const mu of mus) {
    for (const x of xs) {
      for (const buildup of buildups) {
        const r = computeShielding([{ mu, x }], { buildup });
        const label = `mu=${mu} x=${x} buildup=${JSON.stringify(buildup)}`;
        assert.ok(r.buildupFactor >= 1, label);
        // 透射率数学上严格为正；mu*x 超过约 745 时双精度下溢为 0，属正常浮点行为
        assert.ok(r.narrowBeamTransmission >= 0 && r.narrowBeamTransmission <= 1, label);
        assert.ok(r.broadBeamTransmission >= r.narrowBeamTransmission, label);
        assert.ok(r.broadBeamTransmission <= 1, label);
      }
    }
  }
});

test('多层叠加：总透射率 = 各层 mu*x 求和后统一取指数，且能分辨"分层取透射率再相乘"的算法差异', () => {
  // 以下取值在 IEEE-754 下两种算法结果不同（已验证），测试可分辨算法
  const cases = [
    [{ mu: LN2, x: 1 }, { mu: 0.1, x: 1 }],
    [{ mu: 0.03, x: 1 }, { mu: 2.5, x: 1 }],
    [{ mu: 55.451774444795625, x: 0.0125 }, { mu: 0.03, x: 0.1 }, { mu: 2.5, x: 0.4 }],
  ];
  for (const layers of cases) {
    const total = multiLayerNarrowTransmission(layers);
    const depth = layers.reduce((sum, l) => sum + l.mu * l.x, 0);
    const sumThenExp = Math.exp(-depth);
    const productOfLayers = layers.reduce((p, l) => p * Math.exp(-l.mu * l.x), 1);
    // 前置条件：所选取值确实能分辨两种算法
    assert.notEqual(sumThenExp, productOfLayers, `layers=${JSON.stringify(layers)}`);
    // 服务必须采用"先求和再统一取指数"
    assert.equal(total, sumThenExp);
    assert.notEqual(total, productOfLayers);
  }
});

test('computeShielding 多层路径同样先累加光学深度再统一取指数', () => {
  const layers = [
    { material: 'Pb', mu: 55.451774444795625, x: 0.0125 },
    { material: 'Fe', mu: 0.03, x: 0.1 },
    { material: 'concrete', mu: 2.5, x: 0.4 },
  ];
  const r = computeShielding(layers, {});
  const depth = 55.451774444795625 * 0.0125 + 0.03 * 0.1 + 2.5 * 0.4;
  assert.equal(r.opticalDepth, depth);
  assert.equal(r.narrowBeamTransmission, Math.exp(-depth));
});
