'use strict';

/** 端到端 HTTP 接口测试：单层核算、方案登记/取用/核算、错误格式、并发互不串改。 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/app');

let app;

before(async () => {
  app = buildApp({ dbPath: ':memory:' });
});

after(async () => {
  await app.close();
});

const post = (url, payload) => app.inject({ method: 'POST', url, payload });
const get = (url) => app.inject({ method: 'GET', url });

test('健康检查', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok' });
});

test('单层一次性核算：窄束/宽束/HVL/TVL/相对剂量率', async () => {
  const res = await post('/compute/single', { material: 'Pb', mu: 0.5, x: 2, fluenceRate: 1e6 });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.narrowBeamTransmission, Math.exp(-1));
  assert.equal(body.buildupFactor, 1); // 未指定积累因子，默认 B=1
  assert.equal(body.broadBeamTransmission, Math.exp(-1));
  assert.equal(body.totalTransmission, Math.exp(-1));
  assert.equal(body.hvl, Math.LN2 / 0.5);
  assert.equal(body.tvl, Math.LN10 / 0.5);
  assert.equal(body.relativeDoseRate, Math.exp(-1));
  assert.equal(body.incidentFluenceRate, 1e6);
  assert.equal(body.transmittedDoseRate, 1e6 * Math.exp(-1));
});

test('单层核算支持两种积累因子模式', async () => {
  const fixed = await post('/compute/single', { mu: 1.5, x: 2, buildup: { mode: 'fixed', value: 2 } });
  assert.equal(fixed.json().buildupFactor, 2);
  assert.equal(fixed.json().broadBeamTransmission, 2 * Math.exp(-3));

  const linear = await post('/compute/single', { mu: 1.5, x: 2, buildup: { mode: 'linear', coefficient: 0.3 } });
  const k = 1 + 0.3 * 1.5 * 2;
  assert.equal(linear.json().buildupFactor, k);
  assert.equal(linear.json().broadBeamTransmission, k * Math.exp(-3));
});

test('零厚度：无论积累因子是多少，透射率精确等于 1', async () => {
  const res = await post('/compute/single', { mu: 5, x: 0, buildup: { mode: 'fixed', value: 9 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().narrowBeamTransmission, 1);
  assert.equal(res.json().broadBeamTransmission, 1);
});

test('非法参数返回 400 并指明具体参数', async () => {
  const cases = [
    [{ mu: 0, x: 1 }, 'mu'],
    [{ mu: -2, x: 1 }, 'mu'],
    [{ mu: 1, x: -0.5 }, 'x'],
    [{ mu: 1, x: 0.5, fluenceRate: -3 }, 'fluenceRate'],
    [{ mu: 1, x: 0.5, buildup: { mode: 'fixed', value: 0.5 } }, 'buildup.value'],
    [{ mu: 1, x: 0.5, buildup: { mode: 'linear', coefficient: -1 } }, 'buildup.coefficient'],
    [{ mu: 1, x: 0.5, buildup: { mode: 'unknown' } }, 'buildup.mode'],
  ];
  for (const [payload, parameter] of cases) {
    const res = await post('/compute/single', payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    const body = res.json();
    assert.equal(body.error.code, 'INVALID_PARAMETER');
    assert.equal(body.error.parameter, parameter, JSON.stringify(payload));
  }
});

test('登记方案返回方案名，可凭名取用，列表可查', async () => {
  const created = await post('/plans', {
    name: 'api-plan',
    layers: [
      { material: 'Pb', mu: 55.451774444795625, x: 0.0125 },
      { material: 'concrete', mu: 0.15, x: 0.3 },
    ],
    buildup: { mode: 'linear', coefficient: 0.4 },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().name, 'api-plan');

  const fetched = await get('/plans/api-plan');
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(fetched.json().layers, [
    { material: 'Pb', mu: 55.451774444795625, x: 0.0125 },
    { material: 'concrete', mu: 0.15, x: 0.3 },
  ]);
  assert.deepEqual(fetched.json().buildup, { mode: 'linear', coefficient: 0.4 });

  const list = await get('/plans');
  assert.ok(list.json().plans.some((p) => p.name === 'api-plan'));

  // 未指定名字时自动生成
  const auto = await post('/plans', { layers: [{ mu: 1, x: 0.1 }] });
  assert.equal(auto.statusCode, 201);
  assert.match(auto.json().name, /^plan-/);
});

test('同名方案重复登记返回 409', async () => {
  await post('/plans', { name: 'dup-api', layers: [{ mu: 1, x: 0.1 }] });
  const res = await post('/plans', { name: 'dup-api', layers: [{ mu: 2, x: 0.2 }] });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'PLAN_EXISTS');
  // 原方案未被覆盖
  const fetched = await get('/plans/dup-api');
  assert.deepEqual(fetched.json().layers, [{ material: null, mu: 1, x: 0.1 }]);
});

test('方案核算：凭名字 + 入射注量率，可换不同注量率反复算', async () => {
  await post('/plans', { name: 'reuse', layers: [{ mu: 0.5, x: 2 }] });

  const first = await post('/plans/reuse/compute', { fluenceRate: 1000 });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().plan, 'reuse');
  assert.equal(first.json().narrowBeamTransmission, Math.exp(-1));
  assert.equal(first.json().transmittedDoseRate, 1000 * Math.exp(-1));
  assert.equal(first.json().relativeDoseRate, Math.exp(-1));

  // 同一套屏蔽结构换入射源再算，无需重传材料厚度
  const second = await post('/plans/reuse/compute', { fluenceRate: 4000 });
  assert.equal(second.json().narrowBeamTransmission, first.json().narrowBeamTransmission);
  assert.equal(second.json().transmittedDoseRate, 4000 * Math.exp(-1));
  assert.equal(second.json().transmittedDoseRate, 4 * first.json().transmittedDoseRate);
});

test('方案核算：缺少入射注量率返回 400 并指明 fluenceRate', async () => {
  const res = await post('/plans/reuse/compute', {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.parameter, 'fluenceRate');
});

test('方案登记时的默认积累因子生效，核算时可临时覆盖', async () => {
  await post('/plans', {
    name: 'with-buildup',
    layers: [{ mu: 1.5, x: 0.4 }],
    buildup: { mode: 'fixed', value: 2 },
  });
  const useDefault = await post('/plans/with-buildup/compute', { fluenceRate: 10 });
  assert.equal(useDefault.json().buildupFactor, 2);

  const override = await post('/plans/with-buildup/compute', {
    fluenceRate: 10,
    buildup: { mode: 'fixed', value: 1 },
  });
  assert.equal(override.json().buildupFactor, 1);
  assert.equal(override.json().broadBeamTransmission, override.json().narrowBeamTransmission);
});

test('不存在的方案返回 404', async () => {
  const res = await post('/plans/no-such-plan/compute', { fluenceRate: 1 });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'PLAN_NOT_FOUND');
  const got = await get('/plans/no-such-plan');
  assert.equal(got.statusCode, 404);
});

test('内置示范方案已登记，半值层厚度处窄束透射率精确等于 0.5', async () => {
  for (const name of ['demo-co60-lead', 'demo-cs137-lead', 'demo-i131-lead']) {
    const res = await post(`/plans/${name}/compute`, { fluenceRate: 1 });
    assert.equal(res.statusCode, 200, name);
    assert.equal(res.json().narrowBeamTransmission, 0.5, name);
  }
  const co60 = (await get('/plans/demo-co60-lead')).json();
  assert.equal(co60.layers[0].material, 'Pb');
  assert.ok(Math.abs(co60.layers[0].x - 0.0125) < 1e-15);
});

test('多层方案：总透射率先求和再取指数，与逐层相乘的近似可分辨', async () => {
  const layers = [
    { material: 'Pb', mu: 0.6931471805599453, x: 1 },
    { material: 'concrete', mu: 0.1, x: 1 },
  ];
  await post('/plans', { name: 'multi', layers });
  const res = await post('/plans/multi/compute', { fluenceRate: 1 });
  const depth = 0.6931471805599453 * 1 + 0.1 * 1;
  const sumThenExp = Math.exp(-depth);
  const productOfLayers = Math.exp(-0.6931471805599453) * Math.exp(-0.1);
  assert.notEqual(sumThenExp, productOfLayers); // 所选取值可分辨两种算法
  assert.equal(res.json().narrowBeamTransmission, sumThenExp);
  assert.notEqual(res.json().narrowBeamTransmission, productOfLayers);
});

test('宽束始终不小于窄束（接口级抽查）', async () => {
  for (const coefficient of [0, 0.5, 2]) {
    const res = await post('/compute/single', {
      mu: 2.5,
      x: 0.3,
      buildup: { mode: 'linear', coefficient },
    });
    assert.ok(res.json().broadBeamTransmission >= res.json().narrowBeamTransmission);
  }
});

test('并发登记与核算多个方案互不串改', async () => {
  const N = 25;
  const specs = Array.from({ length: N }, (_, i) => ({
    name: `conc-${i}`,
    mu: i + 1,
    x: 0.01 * (i + 1),
    fluenceRate: 100 * (i + 1),
  }));

  const registrations = await Promise.all(
    specs.map((s) => post('/plans', { name: s.name, layers: [{ material: `m${s.mu}`, mu: s.mu, x: s.x }] })),
  );
  registrations.forEach((res, i) => assert.equal(res.statusCode, 201, `register ${specs[i].name}`));

  const computations = await Promise.all(
    specs.map((s) => post(`/plans/${s.name}/compute`, { fluenceRate: s.fluenceRate })),
  );
  computations.forEach((res, i) => {
    const s = specs[i];
    assert.equal(res.statusCode, 200, `compute ${s.name}`);
    const body = res.json();
    // 若甲方案的厚度串到乙方案，opticalDepth 必然对不上
    assert.equal(body.opticalDepth, s.mu * s.x, `plan ${s.name}`);
    assert.equal(body.narrowBeamTransmission, Math.exp(-s.mu * s.x), `plan ${s.name}`);
    assert.equal(body.transmittedDoseRate, s.fluenceRate * Math.exp(-s.mu * s.x), `plan ${s.name}`);
    assert.equal(body.layers[0].material, `m${s.mu}`, `plan ${s.name}`);
  });
});
