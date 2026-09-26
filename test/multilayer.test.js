'use strict';

/** 多层叠加模块测试：光学深度累加、总厚度、有效衰减系数。 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  opticalDepth,
  multiLayerNarrowTransmission,
  totalThickness,
  effectiveMu,
} = require('../src/core/multilayer');

test('光学深度逐层累加，总厚度逐层累加', () => {
  const layers = [
    { mu: 1.5, x: 0.2 },
    { mu: 0.5, x: 0.4 },
    { mu: 3, x: 0.1 },
  ];
  assert.equal(opticalDepth(layers), 1.5 * 0.2 + 0.5 * 0.4 + 3 * 0.1);
  assert.equal(totalThickness(layers), 0.2 + 0.4 + 0.1);
});

test('多层窄束总透射率 = exp(-光学深度)', () => {
  const layers = [
    { mu: 1.5, x: 0.2 },
    { mu: 0.5, x: 0.4 },
  ];
  assert.equal(multiLayerNarrowTransmission(layers), Math.exp(-opticalDepth(layers)));
});

test('单层是多层的特例：与窄束公式一致', () => {
  const layers = [{ mu: 12.3, x: 0.05 }];
  assert.equal(multiLayerNarrowTransmission(layers), Math.exp(-12.3 * 0.05));
  assert.equal(effectiveMu(layers), 12.3);
});

test('有效衰减系数：厚度加权平均；总厚度为零时为 null', () => {
  const layers = [
    { mu: 2, x: 0.5 },
    { mu: 6, x: 0.5 },
  ];
  assert.equal(effectiveMu(layers), (2 * 0.5 + 6 * 0.5) / 1);
  assert.equal(effectiveMu([{ mu: 5, x: 0 }]), null);
});

test('零厚度层不贡献衰减', () => {
  const withZero = [
    { mu: 100, x: 0 },
    { mu: 1.5, x: 0.4 },
  ];
  assert.equal(multiLayerNarrowTransmission(withZero), Math.exp(-1.5 * 0.4));
});
