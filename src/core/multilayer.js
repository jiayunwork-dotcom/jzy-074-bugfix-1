'use strict';

/**
 * 多层屏蔽叠加逻辑。
 *
 * 叠加规则：各层的衰减系数乘厚度（mu_i * x_i）逐层相加得到总光学深度，
 * 再统一取一次指数；不允许分层各算透射率再相乘——数学上两者等价，
 * 但浮点上后者引入额外的累积舍入，工程上也会诱使中间结果被截断/舍入。
 * 本模块的实现保证"先求和、后取指数"这一条路径。
 */

/**
 * 多层光学深度：sum(mu_i * x_i)
 */
function opticalDepth(layers) {
  let sum = 0;
  for (const layer of layers) {
    sum += layer.mu * layer.x;
  }
  return sum;
}

/**
 * 多层窄束总透射率：T = exp(-sum(mu_i * x_i))
 */
function multiLayerNarrowTransmission(layers) {
  return Math.exp(-opticalDepth(layers));
}

/**
 * 屏蔽总厚度：sum(x_i)
 */
function totalThickness(layers) {
  let sum = 0;
  for (const layer of layers) {
    sum += layer.x;
  }
  return sum;
}

/**
 * 有效衰减系数（厚度加权平均）：mu_eff = sum(mu_i*x_i) / sum(x_i)。
 * 用于多层方案 HVL/TVL 的工程估算；总厚度为 0 时无定义，返回 null。
 */
function effectiveMu(layers) {
  const xTotal = totalThickness(layers);
  if (xTotal === 0) return null;
  return opticalDepth(layers) / xTotal;
}

module.exports = {
  opticalDepth,
  multiLayerNarrowTransmission,
  totalThickness,
  effectiveMu,
};
