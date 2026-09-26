'use strict';

/**
 * 积累因子 B（宽束修正），两种计算模式，调用方必须显式指定其一：
 *
 *  - fixed : 调用方直接给定数值，B = value，要求 value >= 1；
 *  - linear: 线性近似 B = 1 + k * tau，tau 为屏蔽的总光学深度（与窄束
 *            取指数 exp(-tau) 用的是同一个量），k 为调用方给定的无量纲
 *            系数（k >= 0）。多层时 tau = sum(mu_i * x_i)，必须逐层求和，
 *            不能用某一层（哪怕是最外层）的 mu 去乘全部层的总厚度——
 *            后者只在单层时恰好与逐层求和相等。
 *
 * B = 1 时宽束退化为窄束。未指定时默认 fixed/B=1（即不做宽束修正）。
 */

const MODES = Object.freeze({
  FIXED: 'fixed',
  LINEAR: 'linear',
});

/** 默认积累因子配置：B = 1，宽束退化为窄束。 */
const DEFAULT_BUILDUP = Object.freeze({ mode: MODES.FIXED, value: 1 });

/**
 * 归一化调用方传入的积累因子配置（假定已通过 validate.js 校验）。
 * 未传入时返回默认配置。
 */
function resolveBuildup(input) {
  if (input === undefined || input === null) return DEFAULT_BUILDUP;
  if (input.mode === MODES.FIXED) return { mode: MODES.FIXED, value: input.value };
  return { mode: MODES.LINEAR, coefficient: input.coefficient };
}

/**
 * 计算单层配置下的积累因子数值（单层原语：tau = mu * x）。
 * @param buildup 归一化后的配置（见 resolveBuildup）
 * @param mu      该层衰减系数
 * @param x       该层厚度
 * @returns {number} B，恒 >= 1
 */
function buildupFactor(buildup, mu, x) {
  return stackBuildupFactor(buildup, mu * x);
}

/**
 * 计算（可能为多层的）屏蔽堆叠的积累因子数值。
 * @param buildup      归一化后的配置（见 resolveBuildup）
 * @param opticalDepth 总光学深度 tau = sum(mu_i * x_i)，与窄束指数衰减
 *                     exp(-tau) 使用同一个逐层求和结果
 * @returns {number} B，恒 >= 1
 */
function stackBuildupFactor(buildup, opticalDepth) {
  if (buildup.mode === MODES.FIXED) return buildup.value;
  return 1 + buildup.coefficient * opticalDepth;
}

/** 宽束透射率（未截断）：T_broad = B * T_narrow */
function broadBeamTransmission(buildup, opticalDepth, narrowTransmission) {
  return stackBuildupFactor(buildup, opticalDepth) * narrowTransmission;
}

module.exports = {
  MODES,
  DEFAULT_BUILDUP,
  resolveBuildup,
  buildupFactor,
  stackBuildupFactor,
  broadBeamTransmission,
};
