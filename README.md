# shielding-service

辐射屏蔽核算服务：给定屏蔽材料、厚度与入射注量率，返回窄束/宽束透射率、半值层、十值层与相对剂量率。核医学与工业探伤防护设计中常用的窄束/宽束两套透射模型在这里钉死为一套可复算的 HTTP 服务，避免每次手算重新推导公式。

## 物理模型

- **窄束透射率**（纯指数衰减，不计散射光子）：`T = exp(-μ·x)`
- **宽束透射率**：`T_broad = B · exp(-μ·x)`，`B ≥ 1` 为积累因子，补偿被散射后仍朝探测方向走的光子；`B = 1` 时宽束退化为窄束
- **半值层** `HVL = ln2 / μ`、**十值层** `TVL = ln10 / μ`：只由衰减系数决定，与入射注量率和积累因子无关
- **多层叠加**：各层 `μᵢ·xᵢ` 逐层相加得总光学深度，**统一取一次指数** `exp(-Σμᵢxᵢ)`；不分层算透射率再相乘（避免累积舍入）
- **多层积累因子**：取最外层（靠近探测器一侧）材料对应的值；`linear` 模式下用最外层 `μ` 与屏蔽总厚度估算
- **截断规则**：透射率物理上不超过 1。薄屏蔽下积累近似可能给出 `B·T > 1`，此时截断为 1 并在响应 `warnings` 中显式说明，绝不静默返回超界结果

### 积累因子两种模式（调用方显式指定）

```json
{ "mode": "fixed",  "value": 1.6 }        // 直接给定 B，必须 >= 1
{ "mode": "linear", "coefficient": 0.4 }  // B = 1 + k·μ·x，k >= 0
```

未指定时默认 `fixed / B = 1`（宽束退化为窄束）。

### 单位约定

`mu` 为线性衰减系数（1/长度），`x` 为厚度（长度），两者单位自洽即可。内置示范方案与示例均用 SI 单位：`mu` 取 `m⁻¹`，`x` 取 `m`。不同材料、不同能量对应不同的 `mu`，服务不做任何跨层/跨场景的继承假设。

## 运行

### 本地

```bash
npm ci
npm test        # 跑全部物理钉死测试
npm start       # 监听 0.0.0.0:3000
```

环境变量：`PORT`（默认 3000）、`HOST`、`SHIELDING_DB_PATH`（SQLite 文件路径，默认 `data/shielding.db`）。

### Docker（运行时锁定 node:20-slim）

```bash
docker build -t shielding-service .
docker run -p 3000:3000 -v shielding-data:/app/data shielding-service
```

构建分两个阶段：构建阶段装好工具链编译/下载 better-sqlite3 原生模块并**跑通全部测试**（测试不过则构建失败），运行阶段只带生产依赖。挂卷 `/app/data` 可持久化方案数据，不挂也能跑（数据随容器生命周期）。

## HTTP 接口

### 1. 登记屏蔽方案 — `POST /plans`

```json
{
  "name": "hot-cell-wall",                 // 可选，缺省自动生成
  "layers": [
    { "material": "Pb",       "mu": 55.45, "x": 0.0125 },
    { "material": "concrete", "mu": 0.15,  "x": 0.2 }
  ],
  "buildup": { "mode": "linear", "coefficient": 0.4 }   // 可选，方案默认积累因子
}
```

返回 `201` 与方案名。同名重复登记返回 `409`。`GET /plans`、`GET /plans/:name` 可列出/取用。

### 2. 凭方案名核算 — `POST /plans/:name/compute`

```json
{ "fluenceRate": 2.5e5, "buildup": { "mode": "fixed", "value": 1.8 } }
```

`fluenceRate` 必填；`buildup` 可选（缺省用方案登记时的配置）。返回窄束透射率、宽束透射率、半值层、十值层、总透射率、相对剂量率、透射剂量率等。同一方案可换不同入射注量率反复核算，无需重传材料厚度。

### 3. 单层一次性核算 — `POST /compute/single`

```json
{ "material": "Pb", "mu": 55.45, "x": 0.0125, "fluenceRate": 1e6,
  "buildup": { "mode": "linear", "coefficient": 0.5 } }
```

不登记、直接算。内部与方案接口共用同一个 `computeShielding`，衰减公式只有一份。

### 响应示例（方案核算）

```json
{
  "plan": "demo-co60-lead",
  "layers": [{ "material": "Pb", "mu": 55.45, "x": 0.0125, "hvl": 0.0125, "tvl": 0.04152 }],
  "opticalDepth": 0.6931,
  "narrowBeamTransmission": 0.5,
  "buildupFactor": 1.3466,
  "broadBeamTransmission": 0.6733,
  "totalTransmission": 0.6733,
  "hvl": 0.0125, "tvl": 0.04152,
  "relativeDoseRate": 0.6733,
  "incidentFluenceRate": 250000,
  "transmittedDoseRate": 168321.7
}
```

字段约定：`totalTransmission` 为含积累修正的有效总透射（剂量估算实际采用值）；`relativeDoseRate` 为屏蔽后/无屏蔽剂量率之比；多层方案的 `hvl`/`tvl` 按厚度加权有效衰减系数 `effectiveMu` 估算（工程近似），各层精确值见 `layers[]`。

### 错误格式

非法参数返回 `400` 并指明具体参数，不会算出负的或超过 1 的透射率还当正常结果：

```json
{ "error": { "code": "INVALID_PARAMETER", "message": "mu (attenuation coefficient) must be > 0, got -1", "parameter": "mu" } }
```

校验规则：`mu > 0`、`x >= 0`、积累因子 `>= 1`（linear 系数 `>= 0`）、`fluenceRate >= 0`。方案不存在 `404 PLAN_NOT_FOUND`，重名 `409 PLAN_EXISTS`。

### 内置示范方案

启动时自动登记（幂等，重复启动不报错）：

| 方案名 | 源 | 材料 | HVL | 说明 |
|---|---|---|---|---|
| `demo-co60-lead` | Co-60 (~1.25 MeV) | Pb | 12.5 mm | 厚度取 1 个 HVL，窄束透射率应恰为 0.5 |
| `demo-cs137-lead` | Cs-137 (0.662 MeV) | Pb | 6.5 mm | 同上 |
| `demo-i131-lead` | I-131 (0.364 MeV) | Pb | 3.0 mm | 同上 |

可直接 `POST /plans/demo-co60-lead/compute` 核对模型算得对不对。

## 项目结构

```
src/
  core/
    attenuation.js   衰减核心：窄束指数衰减、HVL/TVL
    multilayer.js    多层叠加：光学深度逐层累加后统一取指数
    buildup.js       积累因子 fixed / linear 两种模式
    validate.js      参数校验与结构化错误
    shielding.js     统一核算入口（单层与方案接口共用）
  plans/
    store.js         方案登记与存取（SQLite / better-sqlite3）
    seed.js          内置示范方案
  routes/
    plans.js         方案接口
    single.js        单层一次性核算接口
  app.js             Fastify 装配
  index.js           服务入口
test/                node:test 测试（见下）
```

## 测试

`npm test`（Node 内置 `node:test`，无额外测试依赖）。钉死的物理关系与工程行为：

- 零厚度时无论积累因子是多少，透射率精确等于 1
- 厚度翻倍 → 窄束透射率精确变为原来的平方；衰减系数翻倍 ≡ 厚度翻倍
- 半值层处窄束透射率精确等于 1/2；十值层处精确等于 `exp(-ln10)`（见下注）
- 宽束透射率始终不小于窄束透射率，且均不超出 (0, 1]
- 多层叠加 = 先求和再统一取指数，测试取值可在浮点上分辨它与"逐层相乘"的差异
- 方案登记后稳定取用、落盘持久化、并发登记/核算互不串改
- 非法参数（μ≤0、x<0、B<1、注量率<0）一律 400 并指明参数名

> 浮点说明：0.1 在二进制浮点中无精确表示，且 V8 的 `Math.exp(-Math.LN10)` 比字面量 `0.1` 小约 2 ulp（≈2.8e-17），因此十值层测试钉死的是定义式 `T(TVL) === Math.exp(-Math.LN10)` 并附加 `|T-0.1| ≤ 1e-16` 断言；半值层的 0.5 可精确表示，逐位钉死。厚度翻倍的平方律同理采用已验证逐位成立的取值。
