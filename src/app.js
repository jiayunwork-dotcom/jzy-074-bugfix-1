'use strict';

/**
 * 应用装配：建 Fastify 实例、挂方案存取、注册路由、统一错误格式。
 * 与 src/index.js 分离，便于测试用内存库直接 buildApp。
 */

const Fastify = require('fastify');
const { PlanStore } = require('./plans/store');
const { seedDemoPlans } = require('./plans/seed');
const planRoutes = require('./routes/plans');
const singleRoutes = require('./routes/single');

function buildApp(options = {}) {
  const {
    dbPath = process.env.SHIELDING_DB_PATH || 'data/shielding.db',
    seedDemo = true,
    logger = false,
  } = options;

  const app = Fastify({ logger });
  const store = new PlanStore(dbPath);
  if (seedDemo) seedDemoPlans(store);
  app.decorate('planStore', store);

  // 统一错误格式：{ "error": { "code", "message", "parameter"? } }
  app.setErrorHandler((err, request, reply) => {
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    const body = {
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message,
      },
    };
    if (err.parameter) body.error.parameter = err.parameter;
    reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `route not found: ${request.method} ${request.raw.url}` },
    });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(planRoutes);
  app.register(singleRoutes);

  app.addHook('onClose', async () => {
    store.close();
  });

  return app;
}

module.exports = { buildApp };
