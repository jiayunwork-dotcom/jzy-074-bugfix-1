'use strict';

/**
 * 方案接口：
 *   POST /plans              登记一个屏蔽方案（材料层列表 + 可选默认积累因子），返回方案名
 *   GET  /plans              列出全部方案
 *   GET  /plans/:name        凭名字取用方案
 *   POST /plans/:name/compute 凭方案名 + 入射注量率核算（可临时覆盖积累因子配置）
 */

const { computeShielding } = require('../core/shielding');
const { ServiceError } = require('../core/validate');

function planNotFound(name) {
  return new ServiceError('PLAN_NOT_FOUND', `plan not found: ${name}`, { statusCode: 404, parameter: 'name' });
}

async function planRoutes(fastify) {
  const store = fastify.planStore;

  fastify.post('/plans', async (request, reply) => {
    const plan = store.register(request.body ?? {});
    return reply.code(201).send(plan);
  });

  fastify.get('/plans', async () => ({ plans: store.list() }));

  fastify.get('/plans/:name', async (request) => {
    const plan = store.get(request.params.name);
    if (!plan) throw planNotFound(request.params.name);
    return plan;
  });

  fastify.post('/plans/:name/compute', async (request) => {
    const plan = store.get(request.params.name);
    if (!plan) throw planNotFound(request.params.name);
    const body = request.body ?? {};
    if (body.fluenceRate === undefined || body.fluenceRate === null) {
      throw new ServiceError('INVALID_PARAMETER', 'fluenceRate (incident fluence rate) is required for plan computation', {
        statusCode: 400,
        parameter: 'fluenceRate',
      });
    }
    // 本次调用未指定积累因子时，回落到方案登记时的默认配置
    const buildup = body.buildup !== undefined && body.buildup !== null ? body.buildup : plan.buildup;
    const result = computeShielding(plan.layers, { fluenceRate: body.fluenceRate, buildup });
    return { plan: plan.name, ...result };
  });
}

module.exports = planRoutes;
