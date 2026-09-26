'use strict';

/**
 * 轻量一次性核算接口：不登记方案，直接传单层参数核算。
 * 内部与方案接口共用同一个 computeShielding，保证衰减公式只有一份。
 *
 *   POST /compute/single
 *   body: { "material"?, "mu", "x", "fluenceRate"?, "buildup"? }
 */

const { computeShielding } = require('../core/shielding');
const { validateMu, validateThickness, validateFluenceRate, validateBuildup } = require('../core/validate');

async function singleRoutes(fastify) {
  fastify.post('/compute/single', async (request) => {
    const body = request.body ?? {};
    // 先按扁平参数名校验，让错误信息直接指向调用方传入的字段名
    validateMu(body.mu, 'mu');
    validateThickness(body.x, 'x');
    if (body.fluenceRate !== undefined && body.fluenceRate !== null) {
      validateFluenceRate(body.fluenceRate, 'fluenceRate');
    }
    validateBuildup(body.buildup, 'buildup');
    const result = computeShielding(
      [{ material: body.material, mu: body.mu, x: body.x }],
      { fluenceRate: body.fluenceRate, buildup: body.buildup },
    );
    return result;
  });
}

module.exports = singleRoutes;
