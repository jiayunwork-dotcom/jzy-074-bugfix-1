'use strict';

/**
 * 内置示范方案：常见放射源在铅（Pb）中的半值层数据（工程常用近似值）。
 * 每个示范方案的厚度取为恰好一个半值层，因此核算结果的窄束透射率
 * 应当等于 0.5，登记后即可直接核对模型算得对不对。
 *
 * 参考数据（窄束、单位 m）：
 *   Co-60（平均约 1.25 MeV）在铅中 HVL ≈ 12.5 mm
 *   Cs-137（0.662 MeV）     在铅中 HVL ≈ 6.5 mm
 *   I-131（0.364 MeV）      在铅中 HVL ≈ 3.0 mm
 * 衰减系数由 mu = ln2 / HVL 反推，单位 m^-1。
 */

const { LN2 } = require('../core/attenuation');

const DEMO_PLANS = [
  {
    name: 'demo-co60-lead',
    layers: [{ material: 'Pb', mu: LN2 / 0.0125, x: 0.0125 }],
  },
  {
    name: 'demo-cs137-lead',
    layers: [{ material: 'Pb', mu: LN2 / 0.0065, x: 0.0065 }],
  },
  {
    name: 'demo-i131-lead',
    layers: [{ material: 'Pb', mu: LN2 / 0.003, x: 0.003 }],
  },
];

/** 幂等播种：已存在的同名方案跳过，重复启动不会报错也不会覆盖。 */
function seedDemoPlans(store) {
  for (const plan of DEMO_PLANS) {
    try {
      store.register(plan);
    } catch (err) {
      if (err.code !== 'PLAN_EXISTS') throw err;
    }
  }
}

module.exports = { DEMO_PLANS, seedDemoPlans };
