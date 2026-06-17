# FRED API 数据源调研结果

## 已确认的 FRED 序列 ID

| 指标名称 | 序列 ID | 频率 | 单位 | 备注 |
|---------|--------|------|------|------|
| ONRRP (隔夜逆回购) | RRPONTSYD | 日频 | 百万美元 | 已确认可用 |
| OBFR (隔夜银行融资利率) | OBFR | 日频 | 百分比 | 已确认，最新值 3.62% (2026-06-11) |
| SOFR (有担保隔夜融资利率) | SOFR | 日频 | 百分比 | 已确认，最新值 3.60% (2026-06-11) |
| SOFR 成交量 | SOFRVOL | 日频 | 百万美元 | 已确认可用 |
| T10Y2Y (10-2年期国债收益率差) | T10Y2Y | 日频 | 百分比 | 已确认可用 |
| 贴现窗口贷款 | WLCFLPCL | 周频 | 百万美元 | 已确认，Wednesday Level |
| 央行货币互换余额 | SWPT | 周频 | 百万美元 | 已确认，Wednesday Level |
| 美联储准备金 | WRBWFRBL | 周频 | 百万美元 | 已确认，Wednesday Level |
| SRF (常备回购便利) | RPONTSYD | 日频 | 百万美元 | 备选，或从纽约联储页面获取 |
| CME 黄金期货交割量 | N/A | 日频 | 合约数 | 需要从 CME 网站抓取或 API |

## FRED API 访问方式

**基础 URL**: `https://api.stlouisfed.org/fred/series/observations`

**必需参数**:
- `series_id`: 序列 ID
- `api_key`: FRED API 密钥（需要从 https://fredaccount.stlouisfed.org/apikeys 申请）

**可选参数**:
- `limit`: 返回记录数（默认 100000）
- `offset`: 偏移量
- `sort_order`: 排序方式（asc/desc）
- `observation_start`: 开始日期 (YYYY-MM-DD)
- `observation_end`: 结束日期 (YYYY-MM-DD)

**示例请求**:
```
https://api.stlouisfed.org/fred/series/observations?series_id=SOFR&api_key=YOUR_API_KEY&limit=100&sort_order=desc
```

## 数据特性

### 日频数据（OBFR, SOFR, SOFRVOL, T10Y2Y, RRPONTSYD）
- 每个交易日更新一次
- 通常在美国东部时间上午 8-9 点发布
- 适合实时监控

### 周频数据（WLCFLPCL, SWPT, WRBWFRBL）
- 每周三发布
- 代表该周的水平值
- 需要特殊处理周末和假期

## 后端实现建议

1. **定时任务**: 每天美国东部时间 9:30 AM 后运行一次数据刷新（确保数据已发布）
2. **缓存策略**: 将最新数据存储在数据库中，前端从数据库读取
3. **错误处理**: 如果 API 调用失败，使用上次缓存的数据
4. **数据验证**: 检查返回的数据是否有效（非空、数值合理）

## CME 黄金期货数据

**来源**: https://www.cmegroup.com/markets/metals/precious/gold.volume.html

**获取方式**:
- 方案 1: 直接从页面抓取（需要处理动态加载）
- 方案 2: 寻找 CME 的 API 或数据源
- 方案 3: 使用第三方数据服务

**单位**: 1 Unit = 100 Ounce（必须标注）

## API 密钥申请

1. 访问 https://fredaccount.stlouisfed.org/apikeys
2. 填写邮箱和信息
3. 立即获得 API 密钥
4. 无需付费，可免费使用

## 下一步行动

1. [ ] 申请 FRED API 密钥
2. [ ] 测试 FRED API 连接
3. [ ] 确定 CME 黄金期货数据获取方式
4. [ ] 设计数据库模型
5. [ ] 实现后端数据获取函数
