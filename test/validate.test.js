'use strict';

/** 参数校验测试：每条非法输入都必须被拦截，并指明是哪个参数不对。 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ValidationError,
  validateMu,
  validateThickness,
  validateFluenceRate,
  validateBuildup,
  validateLayers,
  validatePlanName,
} = require('../src/core/validate');
const { computeShielding } = require('../src/core/shielding');

function assertValidationError(fn, parameter) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ValidationError, `expected ValidationError, got ${err}`);
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'INVALID_PARAMETER');
    assert.equal(err.parameter, parameter);
    return true;
  });
}

test('衰减系数必须大于零', () => {
  for (const bad of [0, -1, -0.0001, Number.NaN, Number.POSITIVE_INFINITY, '1', undefined, null]) {
    assertValidationError(() => validateMu(bad), 'mu');
  }
  assert.equal(validateMu(0.0001), 0.0001);
});

test('厚度不能是负数，零厚度合法', () => {
  for (const bad of [-0.0001, -10, Number.NaN, '0.5', undefined]) {
    assertValidationError(() => validateThickness(bad), 'x');
  }
  assert.equal(validateThickness(0), 0);
  assert.equal(validateThickness(2.5), 2.5);
});

test('入射注量率不能是负数', () => {
  for (const bad of [-1, -0.5, Number.NaN, '100']) {
    assertValidationError(() => validateFluenceRate(bad), 'fluenceRate');
  }
  assert.equal(validateFluenceRate(0), 0);
  assert.equal(validateFluenceRate(1e6), 1e6);
});

test('积累因子不能小于一；linear 系数不能为负；模式必须显式给出', () => {
  assertValidationError(() => validateBuildup({ mode: 'fixed', value: 0.999 }), 'buildup.value');
  assertValidationError(() => validateBuildup({ mode: 'fixed', value: 0 }), 'buildup.value');
  assertValidationError(() => validateBuildup({ mode: 'fixed' }), 'buildup.value');
  assertValidationError(() => validateBuildup({ mode: 'linear', coefficient: -0.1 }), 'buildup.coefficient');
  assertValidationError(() => validateBuildup({ mode: 'linear' }), 'buildup.coefficient');
  assertValidationError(() => validateBuildup({ mode: 'geometric', value: 2 }), 'buildup.mode');
  assertValidationError(() => validateBuildup({}), 'buildup.mode');
  assertValidationError(() => validateBuildup(5), 'buildup');
  assert.deepEqual(validateBuildup({ mode: 'fixed', value: 1 }), { mode: 'fixed', value: 1 });
  assert.deepEqual(validateBuildup({ mode: 'linear', coefficient: 0.3 }), { mode: 'linear', coefficient: 0.3 });
  assert.equal(validateBuildup(undefined), null);
});

test('材料层列表：非空、每层 mu>0 且 x>=0，错误定位到具体层', () => {
  assertValidationError(() => validateLayers([]), 'layers');
  assertValidationError(() => validateLayers('not-an-array'), 'layers');
  assertValidationError(() => validateLayers([{ mu: -1, x: 0.1 }]), 'layers[0].mu');
  assertValidationError(() => validateLayers([{ mu: 1, x: 0.1 }, { mu: 2, x: -0.5 }]), 'layers[1].x');
  assertValidationError(() => validateLayers([null]), 'layers[0]');
  assertValidationError(() => validateLayers([{ mu: 1, x: 0.1, material: 42 }]), 'layers[0].material');
  const clean = validateLayers([{ material: 'Pb', mu: 1, x: 0.1 }, { mu: 2, x: 0 }]);
  assert.deepEqual(clean, [
    { material: 'Pb', mu: 1, x: 0.1 },
    { material: null, mu: 2, x: 0 },
  ]);
});

test('方案名：可空（自动生成）或合法标识串', () => {
  assert.equal(validatePlanName('hot-cell-wall'), 'hot-cell-wall');
  assertValidationError(() => validatePlanName(''), 'name');
  assertValidationError(() => validatePlanName('has space'), 'name');
  assertValidationError(() => validatePlanName('-leading-dash'), 'name');
  assertValidationError(() => validatePlanName(123), 'name');
});

test('computeShielding 把非法参数挡在计算之外', () => {
  assertValidationError(() => computeShielding([{ mu: 0, x: 1 }]), 'layers[0].mu');
  assertValidationError(() => computeShielding([{ mu: 1, x: -1 }]), 'layers[0].x');
  assertValidationError(() => computeShielding([{ mu: 1, x: 1 }], { fluenceRate: -5 }), 'fluenceRate');
  assertValidationError(() => computeShielding([{ mu: 1, x: 1 }], { buildup: { mode: 'fixed', value: 0.5 } }), 'buildup.value');
});
