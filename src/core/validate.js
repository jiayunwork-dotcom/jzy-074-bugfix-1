'use strict';

/**
 * 参数校验：所有非法输入在这里被拦截，抛出带参数名的结构化错误，
 * 由 HTTP 层转成 400 响应，绝不让非法参数算出负的或超过 1 的透射率
 * 还被当作正常结果返回。
 */

/** 服务级错误：带 HTTP 状态码与机器可读 code。 */
class ServiceError extends Error {
  constructor(code, message, { statusCode = 400, parameter = null } = {}) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.parameter = parameter;
  }
}

/** 参数校验错误：HTTP 400，必须指明是哪个参数不对。 */
class ValidationError extends ServiceError {
  constructor(parameter, message) {
    super('INVALID_PARAMETER', message, { statusCode: 400, parameter });
    this.name = 'ValidationError';
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 衰减系数 mu：必须是有限数且 > 0。 */
function validateMu(mu, parameter = 'mu') {
  if (!isFiniteNumber(mu)) {
    throw new ValidationError(parameter, `${parameter} (attenuation coefficient) must be a finite number, got ${JSON.stringify(mu)}`);
  }
  if (mu <= 0) {
    throw new ValidationError(parameter, `${parameter} (attenuation coefficient) must be > 0, got ${mu}`);
  }
  return mu;
}

/** 厚度 x：必须是有限数且 >= 0（零厚度合法，表示不衰减）。 */
function validateThickness(x, parameter = 'x') {
  if (!isFiniteNumber(x)) {
    throw new ValidationError(parameter, `${parameter} (thickness) must be a finite number, got ${JSON.stringify(x)}`);
  }
  if (x < 0) {
    throw new ValidationError(parameter, `${parameter} (thickness) must be >= 0, got ${x}`);
  }
  return x;
}

/** 入射注量率：必须是有限数且 >= 0。 */
function validateFluenceRate(fluenceRate, parameter = 'fluenceRate') {
  if (!isFiniteNumber(fluenceRate)) {
    throw new ValidationError(parameter, `${parameter} (incident fluence rate) must be a finite number, got ${JSON.stringify(fluenceRate)}`);
  }
  if (fluenceRate < 0) {
    throw new ValidationError(parameter, `${parameter} (incident fluence rate) must be >= 0, got ${fluenceRate}`);
  }
  return fluenceRate;
}

/**
 * 积累因子配置：{ mode: 'fixed', value } 或 { mode: 'linear', coefficient }。
 * fixed 模式 value 必须 >= 1；linear 模式 coefficient 必须 >= 0。
 * 未传入（null/undefined）时返回 null，由调用方决定默认值。
 */
function validateBuildup(input, parameter = 'buildup') {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(parameter, `${parameter} must be an object like { "mode": "fixed", "value": 1.5 } or { "mode": "linear", "coefficient": 0.3 }`);
  }
  const { mode } = input;
  if (mode === 'fixed') {
    if (!isFiniteNumber(input.value)) {
      throw new ValidationError(`${parameter}.value`, `${parameter}.value must be a finite number, got ${JSON.stringify(input.value)}`);
    }
    if (input.value < 1) {
      throw new ValidationError(`${parameter}.value`, `${parameter}.value (buildup factor) must be >= 1, got ${input.value}`);
    }
    return { mode: 'fixed', value: input.value };
  }
  if (mode === 'linear') {
    if (!isFiniteNumber(input.coefficient)) {
      throw new ValidationError(`${parameter}.coefficient`, `${parameter}.coefficient must be a finite number, got ${JSON.stringify(input.coefficient)}`);
    }
    if (input.coefficient < 0) {
      throw new ValidationError(`${parameter}.coefficient`, `${parameter}.coefficient must be >= 0, got ${input.coefficient}`);
    }
    return { mode: 'linear', coefficient: input.coefficient };
  }
  throw new ValidationError(`${parameter}.mode`, `${parameter}.mode must be "fixed" or "linear", got ${JSON.stringify(mode)}`);
}

/**
 * 材料层列表：非空数组，每层 { material?, mu, x }。
 * material 为可选字符串标签；mu > 0；x >= 0。
 * 返回规范化后的新数组（不改动入参）。
 */
function validateLayers(layers, parameter = 'layers') {
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new ValidationError(parameter, `${parameter} must be a non-empty array of { "material"?, "mu", "x" }`);
  }
  return layers.map((layer, index) => {
    const prefix = `${parameter}[${index}]`;
    if (layer === null || typeof layer !== 'object' || Array.isArray(layer)) {
      throw new ValidationError(prefix, `${prefix} must be an object like { "material"?, "mu", "x" }`);
    }
    const mu = validateMu(layer.mu, `${prefix}.mu`);
    const x = validateThickness(layer.x, `${prefix}.x`);
    let material = null;
    if (layer.material !== undefined && layer.material !== null) {
      if (typeof layer.material !== 'string' || layer.material.length === 0 || layer.material.length > 100) {
        throw new ValidationError(`${prefix}.material`, `${prefix}.material must be a string of 1..100 characters`);
      }
      material = layer.material;
    }
    return { material, mu, x };
  });
}

/** 方案名：调用方可指定，需为 1..128 位的字母数字开头标识串。 */
function validatePlanName(name, parameter = 'name') {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
    throw new ValidationError(
      parameter,
      `${parameter} must be a string of 1..128 chars matching /^[A-Za-z0-9][A-Za-z0-9._-]*$/, got ${JSON.stringify(name)}`,
    );
  }
  return name;
}

module.exports = {
  ServiceError,
  ValidationError,
  validateMu,
  validateThickness,
  validateFluenceRate,
  validateBuildup,
  validateLayers,
  validatePlanName,
};
