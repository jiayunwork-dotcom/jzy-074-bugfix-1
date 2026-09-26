'use strict';

/**
 * 衰减核心：窄束指数衰减、半值层 / 十值层。
 *
 * 本模块只做纯计算，不做参数校验（校验见 core/validate.js）。
 * 单位约定：mu 为线性衰减系数（1/长度），x 为厚度（长度），
 * 两者单位自洽即可（如 mu 取 m^-1 则 x 取 m）。不同材料、不同能量
 * 对应不同的 mu，本模块不假设 mu 跨层或跨场景保持不变。
 * 多层叠加逻辑见 core/multilayer.js。
 */

const LN2 = Math.LN2;
const LN10 = Math.LN10;

/**
 * 窄束透射率：T = exp(-mu * x)
 * 纯指数衰减，不计被散射后重新进入探测方向的光子。
 */
function narrowBeamTransmission(mu, x) {
  return Math.exp(-mu * x);
}

/**
 * 半值层 HVL = ln2 / mu
 * 透射率降到 1/2 所需的厚度，只由衰减系数决定，
 * 与入射注量率和积累因子无关。
 */
function halfValueLayer(mu) {
  return LN2 / mu;
}

/**
 * 十值层 TVL = ln10 / mu
 * 透射率降到 1/10 所需的厚度，只由衰减系数决定，
 * 与入射注量率和积累因子无关。
 */
function tenthValueLayer(mu) {
  return LN10 / mu;
}

module.exports = {
  LN2,
  LN10,
  narrowBeamTransmission,
  halfValueLayer,
  tenthValueLayer,
};
