'use strict';

/** 衰减核心模块的定义式测试：窄束指数衰减、HVL/TVL。 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  narrowBeamTransmission,
  halfValueLayer,
  tenthValueLayer,
  LN2,
  LN10,
} = require('../src/core/attenuation');

test('窄束透射率就是 exp(-mu*x)', () => {
  assert.equal(narrowBeamTransmission(2, 0.5), Math.exp(-1));
  assert.equal(narrowBeamTransmission(0.15, 0.2), Math.exp(-0.03));
});

test('HVL = ln2/mu，TVL = ln10/mu，只由衰减系数决定', () => {
  for (const mu of [0.01, 0.5, 1, 55.451774444795625, 1000]) {
    assert.equal(halfValueLayer(mu), LN2 / mu);
    assert.equal(tenthValueLayer(mu), LN10 / mu);
  }
});

test('TVL 与 HVL 的换算关系：TVL = HVL * log2(10)', () => {
  for (const mu of [0.5, 12.3, 231.04906018664842]) {
    assert.ok(Math.abs(tenthValueLayer(mu) - halfValueLayer(mu) * (LN10 / LN2)) <= 1e-15 * tenthValueLayer(mu));
  }
});

test('透射率随厚度单调不增', () => {
  const mu = 1.5;
  let prev = 1;
  for (const x of [0, 0.01, 0.1, 0.5, 1, 5]) {
    const t = narrowBeamTransmission(mu, x);
    assert.ok(t <= prev);
    prev = t;
  }
});
