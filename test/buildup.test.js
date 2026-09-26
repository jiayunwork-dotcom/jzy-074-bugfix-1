'use strict';

/** 积累因子模块测试：fixed / linear 两种模式与默认行为。 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MODES, DEFAULT_BUILDUP, resolveBuildup, buildupFactor } = require('../src/core/buildup');
const { computeShielding } = require('../src/core/shielding');

test('fixed 模式：B 等于调用方给定的值', () => {
  assert.equal(buildupFactor({ mode: MODES.FIXED, value: 2.5 }, 10, 0.3), 2.5);
  assert.equal(buildupFactor({ mode: MODES.FIXED, value: 1 }, 10, 0.3), 1);
});

test('linear 模式：B = 1 + k*mu*x', () => {
  assert.equal(buildupFactor({ mode: MODES.LINEAR, coefficient: 0.3 }, 1.5, 0.4), 1 + 0.3 * 1.5 * 0.4);
  assert.equal(buildupFactor({ mode: MODES.LINEAR, coefficient: 0 }, 1.5, 0.4), 1);
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

test('多层时 linear 模式取最外层材料的 mu 与屏蔽总厚度', () => {
  const layers = [
    { mu: 10, x: 0.1 },
    { mu: 50, x: 0.2 },
    { mu: 5, x: 0.3 }, // 最外层
  ];
  const k = 0.4;
  const r = computeShielding(layers, { buildup: { mode: 'linear', coefficient: k } });
  const expectedB = 1 + k * 5 * (0.1 + 0.2 + 0.3);
  assert.equal(r.buildupFactor, expectedB);
  assert.equal(r.broadBeamTransmission, expectedB * r.narrowBeamTransmission);
});

test('薄屏蔽下线性近似给出 B*T > 1 时截断为 1 并告警', () => {
  const r = computeShielding([{ mu: 0.01, x: 0.001 }], { buildup: { mode: 'fixed', value: 50 } });
  assert.equal(r.broadBeamTransmission, 1);
  assert.equal(r.totalTransmission, 1);
  assert.ok(Array.isArray(r.warnings) && r.warnings.length > 0);
});
