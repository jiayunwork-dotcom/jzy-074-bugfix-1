'use strict';

/** 积累因子模块测试：fixed / linear 两种模式与默认行为。 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MODES, DEFAULT_BUILDUP, resolveBuildup, buildupFactor } = require('../src/core/buildup');
const { computeShielding } = require('../src/core/shielding');

test('fixed 模式：B 等于调用方给定的值，与光学深度无关', () => {
  assert.equal(buildupFactor({ mode: MODES.FIXED, value: 2.5 }, 0.3), 2.5);
  assert.equal(buildupFactor({ mode: MODES.FIXED, value: 1 }, 0.3), 1);
});

test('linear 模式：B = 1 + k*D，D 为总光学深度', () => {
  assert.equal(buildupFactor({ mode: MODES.LINEAR, coefficient: 0.3 }, 0.6), 1 + 0.3 * 0.6);
  assert.equal(buildupFactor({ mode: MODES.LINEAR, coefficient: 0 }, 0.6), 1);
});

test('未指定积累因子时默认 B = 1，宽束退化为窄束', () => {
  assert.deepEqual(resolveBuildup(undefined), DEFAULT_BUILDUP);
  assert.deepEqual(resolveBuildup(null), DEFAULT_BUILDUP);
  const r = computeShielding([{ mu: 1.5, x: 0.4 }], {});
  assert.equal(r.buildupFactor, 1);
  assert.equal(r.broadBeamTransmission, r.narrowBeamTransmission);
});

test('B = 1 时宽束精确等于窄束', () => {
  for (const buildup of [{ mode: 'fixed', value: 1 }, { mode: 'linear', coefficient: 0 }]) {
    const r = computeShielding([{ mu: 12.3, x: 0.05 }], { buildup });
    assert.equal(r.broadBeamTransmission, r.narrowBeamTransmission);
  }
});

test('多层时 linear 模式用总光学深度（各层 mu*x 逐层求和）代入', () => {
  const layers = [
    { mu: 10, x: 0.1 },
    { mu: 50, x: 0.2 },
    { mu: 5, x: 0.3 }, // 最外层
  ];
  const k = 0.4;
  const r = computeShielding(layers, { buildup: { mode: 'linear', coefficient: k } });
  // B = 1 + k * (10*0.1 + 50*0.2 + 5*0.3) = 1 + 0.4 * 12.5 = 6，
  // 与窄束取指数用的是同一个总光学深度
  const expectedB = 1 + k * (10 * 0.1 + 50 * 0.2 + 5 * 0.3);
  assert.equal(r.buildupFactor, expectedB);
  assert.equal(r.broadBeamTransmission, expectedB * r.narrowBeamTransmission);
});

test('多层 linear 模式可分辨"总光学深度求和"与"单层 mu 乘总厚度"两种算法', () => {
  // 两层且衰减系数相差两个数量级：两种算法给出明显不同的结果
  const cases = [
    [
      { mu: 200, x: 0.02 }, // mu*x = 4，高衰减薄层
      { mu: 2, x: 0.5 }, // 最外层，mu*x = 1，低衰减厚层
    ],
    [
      { mu: 10, x: 0.1 }, // mu*x = 1
      { mu: 50, x: 0.2 }, // mu*x = 10
      { mu: 5, x: 0.3 }, // 最外层，mu*x = 1.5
    ],
  ];
  const k = 0.5;
  for (const layers of cases) {
    const r = computeShielding(layers, { buildup: { mode: 'linear', coefficient: k } });
    const depth = layers.reduce((sum, l) => sum + l.mu * l.x, 0);
    const byOpticalDepth = 1 + k * depth;
    // 曾经的错误算法：最外层 mu × 全部层加起来的总厚度
    const outer = layers[layers.length - 1];
    const byOuterMuTotalX = 1 + k * outer.mu * layers.reduce((sum, l) => sum + l.x, 0);
    // 前置条件：所选取值确实能分辨两种算法
    assert.notEqual(byOpticalDepth, byOuterMuTotalX, `layers=${JSON.stringify(layers)}`);
    assert.equal(r.buildupFactor, byOpticalDepth, `layers=${JSON.stringify(layers)}`);
    assert.notEqual(r.buildupFactor, byOuterMuTotalX, `layers=${JSON.stringify(layers)}`);
    assert.equal(r.broadBeamTransmission, byOpticalDepth * r.narrowBeamTransmission);
  }
});

test('薄屏蔽下线性近似给出 B*T > 1 时截断为 1 并告警', () => {
  const r = computeShielding([{ mu: 0.01, x: 0.001 }], { buildup: { mode: 'fixed', value: 50 } });
  assert.equal(r.broadBeamTransmission, 1);
  assert.equal(r.totalTransmission, 1);
  assert.ok(Array.isArray(r.warnings) && r.warnings.length > 0);
});
