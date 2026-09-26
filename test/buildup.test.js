'use strict';

/** 积累因子模块测试：fixed / linear 两种模式与默认行为。 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MODES, DEFAULT_BUILDUP, resolveBuildup, buildupFactor, stackBuildupFactor } = require('../src/core/buildup');
const { computeShielding } = require('../src/core/shielding');

test('fixed 模式：B 等于调用方给定的值', () => {
  assert.equal(buildupFactor({ mode: MODES.FIXED, value: 2.5 }, 10, 0.3), 2.5);
  assert.equal(buildupFactor({ mode: MODES.FIXED, value: 1 }, 10, 0.3), 1);
});

test('linear 模式：B = 1 + k*mu*x（单层原语）', () => {
  assert.equal(buildupFactor({ mode: MODES.LINEAR, coefficient: 0.3 }, 1.5, 0.4), 1 + 0.3 * 1.5 * 0.4);
  assert.equal(buildupFactor({ mode: MODES.LINEAR, coefficient: 0 }, 1.5, 0.4), 1);
});

test('linear 堆叠：B = 1 + k * 总光学深度 sum(mu_i*x_i)，单层时退化为 mu*x', () => {
  assert.equal(stackBuildupFactor({ mode: MODES.LINEAR, coefficient: 0.4 }, 12.5), 1 + 0.4 * 12.5);
  assert.equal(stackBuildupFactor({ mode: MODES.LINEAR, coefficient: 0.4 }, 0), 1);
  assert.equal(
    buildupFactor({ mode: MODES.LINEAR, coefficient: 0.3 }, 1.5, 0.4),
    stackBuildupFactor({ mode: MODES.LINEAR, coefficient: 0.3 }, 1.5 * 0.4),
  );
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

test('多层时 linear 模式必须按各层 mu*x 逐层求和的总光学深度计算', () => {
  // 真实工程数据回归：三层衰减系数差异很大（10 / 50 / 5，最外层 mu 最小）
  const layers = [
    { mu: 10, x: 0.1 },
    { mu: 50, x: 0.2 },
    { mu: 5, x: 0.3 }, // 最外层（靠近探测器）
  ];
  const k = 0.4;
  const r = computeShielding(layers, { buildup: { mode: 'linear', coefficient: k } });
  const depth = 10 * 0.1 + 50 * 0.2 + 5 * 0.3; // 12.5
  assert.equal(depth, r.opticalDepth);
  // 正确物理关系：B = 1 + k * Σ(mu_i*x_i) = 6
  const expectedB = 1 + k * depth;
  assert.equal(expectedB, 6);
  assert.equal(r.buildupFactor, expectedB);
  assert.equal(r.broadBeamTransmission, expectedB * r.narrowBeamTransmission);
});

test('回归守卫：多层 linear 积累因子不得用单层 mu 乘全部层总厚度', () => {
  // 该用例专门区分两种算法：
  //   正确：B = 1 + k * Σ(mu_i*x_i)（总光学深度逐层求和）
  //   错误：B = 1 + k * mu_j * Σx_i（任取一层——如最外层——的 mu 乘总厚度）
  // 两者只在单层时恰好相等；以下取至少两层且各层 mu 差异很大，保证偏差可被分辨。
  const k = 0.4;

  // 两层、mu 相差百倍；最外层是高 mu 层时错误算法会偏大
  {
    const layers = [{ mu: 1, x: 1 }, { mu: 100, x: 0.01 }];
    const depth = 1 * 1 + 100 * 0.01; // 2
    const totalThickness = 1 + 0.01; // 1.01
    const outerMu = 100;
    const buggyB = 1 + k * outerMu * totalThickness; // 41.4 —— 错误算法
    const r = computeShielding(layers, { buildup: { mode: 'linear', coefficient: k } });
    assert.equal(r.opticalDepth, depth);
    assert.notEqual(buggyB, 1 + k * depth); // 前置条件：取值确实能分辨两种算法
    assert.equal(r.buildupFactor, 1 + k * depth); // 1.8
    assert.notEqual(r.buildupFactor, buggyB);
    assert.equal(r.broadBeamTransmission, r.buildupFactor * r.narrowBeamTransmission);
  }

  // 两层、最外层是低 mu 层时错误算法会偏小（等价于上面三层工程数据的两层版本）
  {
    const layers = [{ mu: 100, x: 0.01 }, { mu: 1, x: 1 }];
    const depth = 100 * 0.01 + 1 * 1; // 2
    const outerMu = 1;
    const buggyB = 1 + k * outerMu * (0.01 + 1); // 1.404
    const r = computeShielding(layers, { buildup: { mode: 'linear', coefficient: k } });
    assert.notEqual(buggyB, 1 + k * depth);
    assert.equal(r.buildupFactor, 1 + k * depth); // 1.8
    assert.notEqual(r.buildupFactor, buggyB);
  }

  // 反证：单层时两种算法确实相等，单层行为不被本次修复改变
  {
    const single = computeShielding([{ mu: 7, x: 0.2 }], { buildup: { mode: 'linear', coefficient: k } });
    assert.equal(single.buildupFactor, 1 + k * 7 * 0.2);
    assert.equal(single.buildupFactor, 1 + k * single.opticalDepth);
  }
});

test('薄屏蔽下线性近似给出 B*T > 1 时截断为 1 并告警', () => {
  const r = computeShielding([{ mu: 0.01, x: 0.001 }], { buildup: { mode: 'fixed', value: 50 } });
  assert.equal(r.broadBeamTransmission, 1);
  assert.equal(r.totalTransmission, 1);
  assert.ok(Array.isArray(r.warnings) && r.warnings.length > 0);
});
