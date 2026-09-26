'use strict';

/** 方案存取测试：登记、取用、落地持久化、并发登记互不串改。 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PlanStore } = require('../src/plans/store');

function tmpDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shielding-test-')), 'plans.db');
}

test('登记方案返回方案名；未指定名字时自动生成', () => {
  const store = new PlanStore(':memory:');
  const a = store.register({ layers: [{ material: 'Pb', mu: 55.45, x: 0.0125 }] });
  assert.match(a.name, /^plan-[0-9a-f-]{36}$/);
  const b = store.register({ name: 'my-plan', layers: [{ mu: 1, x: 0.1 }], buildup: { mode: 'fixed', value: 1.5 } });
  assert.equal(b.name, 'my-plan');
  assert.notEqual(a.name, b.name);
  store.close();
});

test('登记后可凭名字稳定取用，层数据与积累因子配置原样返回', () => {
  const store = new PlanStore(':memory:');
  const layers = [
    { material: 'Pb', mu: 55.45, x: 0.0125 },
    { material: 'concrete', mu: 0.15, x: 0.3 },
  ];
  store.register({ name: 'cell', layers, buildup: { mode: 'linear', coefficient: 0.4 } });
  const got = store.get('cell');
  assert.equal(got.name, 'cell');
  assert.deepEqual(got.layers, layers);
  assert.deepEqual(got.buildup, { mode: 'linear', coefficient: 0.4 });
  assert.equal(store.get('no-such-plan'), null);
  store.close();
});

test('同名方案重复登记返回 409 冲突，不覆盖原方案', () => {
  const store = new PlanStore(':memory:');
  store.register({ name: 'dup', layers: [{ mu: 1, x: 0.1 }] });
  assert.throws(
    () => store.register({ name: 'dup', layers: [{ mu: 9, x: 9 }] }),
    (err) => err.code === 'PLAN_EXISTS' && err.statusCode === 409,
  );
  assert.deepEqual(store.get('dup').layers, [{ material: null, mu: 1, x: 0.1 }]);
  store.close();
});

test('方案数据落盘：关闭后重开仍在', () => {
  const dbPath = tmpDbPath();
  const store1 = new PlanStore(dbPath);
  store1.register({ name: 'persisted', layers: [{ material: 'Pb', mu: 12.3, x: 0.05 }] });
  store1.close();
  const store2 = new PlanStore(dbPath);
  const got = store2.get('persisted');
  assert.deepEqual(got.layers, [{ material: 'Pb', mu: 12.3, x: 0.05 }]);
  store2.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  fs.rmdirSync(path.dirname(dbPath));
});

test('非法层数据在登记边界被拦截，不会落库', () => {
  const store = new PlanStore(':memory:');
  assert.throws(() => store.register({ name: 'bad', layers: [{ mu: -1, x: 0.1 }] }), /mu/);
  assert.throws(() => store.register({ name: 'bad', layers: [] }), /layers/);
  assert.equal(store.get('bad'), null);
  store.close();
});

test('并发登记多个方案互不串改', async () => {
  const store = new PlanStore(':memory:');
  const N = 30;
  const specs = Array.from({ length: N }, (_, i) => ({
    name: `concurrent-${i}`,
    layers: [
      { material: `mat-${i}`, mu: i + 1, x: 0.01 * (i + 1) },
      { material: 'common', mu: 0.5, x: i },
    ],
    buildup: { mode: 'linear', coefficient: 0.1 * i },
  }));
  await Promise.all(specs.map((spec) => Promise.resolve().then(() => store.register(spec))));
  const all = store.list();
  assert.equal(all.length, N);
  for (const spec of specs) {
    const got = store.get(spec.name);
    assert.deepEqual(got.layers, spec.layers, `plan ${spec.name} layers crossed with another plan`);
    assert.deepEqual(got.buildup, spec.buildup);
  }
  store.close();
});
