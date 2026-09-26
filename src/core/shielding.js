'use strict';

/**
 * 统一核算入口：单层一次性核算与具名方案核算共用这一套公式，
 * 保证两个接口的衰减模型永远一致。
 *
 * 物理模型：
 *  - 窄束透射率  T_narrow = exp(-sum(mu_i * x_i))，多层先把 mu*x 逐层累加再统一取指数；
 *  - 宽束透射率  T_broad  = B * T_narrow，B 为积累因子（>= 1），
 *    多层时 B 取最外层（靠近探测器一侧）材料对应的值：
 *    fixed 模式直接用给定值；linear 模式用最外层 mu 与屏蔽总厚度估算；
 *  - 半值层 HVL = ln2/mu、十值层 TVL = ln10/mu，只由衰减系数决定；
 *    多层方案另给出按厚度加权有效衰减系数 mu_eff 估算的 HVL/TVL；
 *  - 相对剂量率 = 有屏蔽 / 无屏蔽剂量率之比 = 总透射率（含积累修正）。
 *
 * 截断规则：透射率物理上不可能超过 1。薄屏蔽下线性积累近似可能给出
 * B * T_narrow > 1，此时截断为 1 并在 warnings 中显式说明，
 * 绝不把超过 1 的透射率当作正常结果静默返回。
 */

const attenuation = require('./attenuation');
const multilayer = require('./multilayer');
const { resolveBuildup, buildupFactor } = require('./buildup');
const { validateLayers, validateFluenceRate, validateBuildup } = require('./validate');

/**
 * @param rawLayers 材料层列表 [{ material?, mu, x }]，按从源到探测器顺序排列，
 *                  最后一层为最外层。函数内统一校验。
 * @param options   { fluenceRate?, buildup? }；fluenceRate 缺省时只返回透射类结果。
 */
function computeShielding(rawLayers, options = {}) {
  const layers = validateLayers(rawLayers);
  const buildup = resolveBuildup(validateBuildup(options.buildup));
  const fluenceRate = options.fluenceRate === undefined || options.fluenceRate === null
    ? null
    : validateFluenceRate(options.fluenceRate);

  // 多层叠加：各层 mu*x 逐层相加，统一取一次指数
  const depth = multilayer.opticalDepth(layers);
  const narrow = Math.exp(-depth);

  // 积累因子取最外层材料对应的值
  const outerLayer = layers[layers.length - 1];
  const thickness = multilayer.totalThickness(layers);
  const B = buildupFactor(buildup, outerLayer.mu, thickness);

  const warnings = [];
  let broad = B * narrow;
  if (broad > 1) {
    broad = 1;
    warnings.push(
      'broad-beam transmission exceeded 1 (buildup approximation is outside its valid range for this configuration); capped at 1',
    );
  }

  const muEff = multilayer.effectiveMu(layers);
  const result = {
    layers: layers.map((layer) => ({
      ...layer,
      hvl: attenuation.halfValueLayer(layer.mu),
      tvl: attenuation.tenthValueLayer(layer.mu),
    })),
    layerCount: layers.length,
    totalThickness: thickness,
    opticalDepth: depth,
    narrowBeamTransmission: narrow,
    buildup,
    buildupFactor: B,
    broadBeamTransmission: broad,
    // 总透射率：含积累修正的有效总透射，是剂量估算实际采用的透射率
    totalTransmission: broad,
    // 方案级 HVL/TVL：单层时精确等于 ln2/mu、ln10/mu；
    // 多层时按厚度加权有效衰减系数 mu_eff 估算（工程近似），各层精确值见 layers[]
    effectiveMu: muEff,
    hvl: muEff === null ? null : attenuation.halfValueLayer(muEff),
    tvl: muEff === null ? null : attenuation.tenthValueLayer(muEff),
    // 相对剂量率 = 屏蔽后剂量率 / 无屏蔽剂量率
    relativeDoseRate: broad,
  };
  if (warnings.length > 0) result.warnings = warnings;

  if (fluenceRate !== null) {
    result.incidentFluenceRate = fluenceRate;
    result.transmittedDoseRate = fluenceRate * broad;
    result.narrowBeamDoseRate = fluenceRate * narrow;
  }
  return result;
}

module.exports = { computeShielding };
