'use strict';

/**
 * 方案存取：具名屏蔽方案的登记与取用，用容器内 SQLite（better-sqlite3）落地，
 * 不依赖外部数据库。better-sqlite3 为同步驱动，配合事务保证并发请求下
 * 多个方案的登记与计算互不影响、互不串改。
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const { ServiceError, validateLayers, validateBuildup, validatePlanName } = require('../core/validate');

class PlanConflictError extends ServiceError {
  constructor(name) {
    super('PLAN_EXISTS', `plan already exists: ${name}`, { statusCode: 409, parameter: 'name' });
    this.name = 'PlanConflictError';
  }
}

function deserialize(row) {
  return {
    name: row.name,
    layers: JSON.parse(row.layers),
    buildup: row.buildup === null ? null : JSON.parse(row.buildup),
    createdAt: row.created_at,
  };
}

class PlanStore {
  /**
   * @param dbPath SQLite 文件路径；传 ':memory:' 则使用内存库（测试用）。
   */
  constructor(dbPath) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shielding_plans (
        name       TEXT PRIMARY KEY,
        layers     TEXT NOT NULL,
        buildup    TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this._insert = this.db.prepare(
      'INSERT INTO shielding_plans (name, layers, buildup, created_at) VALUES (?, ?, ?, ?)',
    );
    this._byName = this.db.prepare('SELECT name, layers, buildup, created_at FROM shielding_plans WHERE name = ?');
    this._all = this.db.prepare('SELECT name, layers, buildup, created_at FROM shielding_plans ORDER BY name');
    // 查重 + 写入放在同一事务里，并发登记同名方案时只会有一个成功
    this._registerTx = this.db.transaction((name, layersJson, buildupJson, createdAt) => {
      if (this._byName.get(name)) throw new PlanConflictError(name);
      this._insert.run(name, layersJson, buildupJson, createdAt);
    });
  }

  /**
   * 登记一个屏蔽方案并返回方案名。
   * @param plan { name?, layers, buildup? }；name 缺省时自动生成。
   * layers 与 buildup 在这里统一校验，落库的永远是合法结构。
   */
  register(plan) {
    if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
      throw new ServiceError('INVALID_PARAMETER', 'plan must be an object like { "name"?, "layers": [...], "buildup"? }', {
        statusCode: 400,
        parameter: 'plan',
      });
    }
    const layers = validateLayers(plan.layers);
    const buildup = validateBuildup(plan.buildup);
    const name = plan.name === undefined || plan.name === null
      ? `plan-${randomUUID()}`
      : validatePlanName(plan.name);
    const createdAt = new Date().toISOString();
    this._registerTx(name, JSON.stringify(layers), buildup === null ? null : JSON.stringify(buildup), createdAt);
    return { name, layers, buildup, createdAt };
  }

  /** 凭方案名取用；不存在返回 null。 */
  get(name) {
    const row = this._byName.get(name);
    return row ? deserialize(row) : null;
  }

  /** 列出全部已登记方案。 */
  list() {
    return this._all.all().map(deserialize);
  }

  close() {
    this.db.close();
  }
}

module.exports = { PlanStore, PlanConflictError };
