'use strict';

/**
 * 积累因子 B（宽束修正），两种计算模式，调用方必须显式指定其一：
 *
 *  - fixed : 调用方直接给定数值，B = value，要求 value >= 1；
 *  - linear: 线性近似 B = 1 + k * (mu * x)，k 为调用方给定的无量纲系数（k >= 0），
 *            mu、x 由服务在核算时代入（多层时取最外层材料的 mu 与屏蔽总厚度）。
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
 * 计算积累因子数值。
 * @param buildup 归一化后的配置（见 resolveBuildup）
 * @param mu      衰减系数（多层时取最外层材料的 mu）
 * @param x       厚度（多层时取屏蔽总厚度）
 * @returns {number} B，恒 >= 1
 */
function buildupFactor(buildup, mu, x) {
  if (buildup.mode === MODES.FIXED) return buildup.value;
  return 1 + buildup.coefficient * mu * x;
}

/** 宽束透射率（未截断）：T_broad = B * T_narrow */
function broadBeamTransmission(buildup, mu, x, narrowTransmission) {
  return buildupFactor(buildup, mu, x) * narrowTransmission;
}

module.exports = {
  MODES,
  DEFAULT_BUILDUP,
  resolveBuildup,
  buildupFactor,
  broadBeamTransmission,
};
