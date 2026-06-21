/**
 * FRED API 客户端
 * 用于从 Federal Reserve Economic Data (FRED) 获取经济指标数据
 */

import axios from "axios";

const FRED_API_BASE_URL = "https://api.stlouisfed.org/fred";

interface FREDObservation {
  date: string;
  value: string;
}

interface FREDSeriesResponse {
  observations: FREDObservation[];
}

/**
 * FRED 指标配置
 */
export const FRED_INDICATORS = {
  ONRRP: {
    seriesId: "RRPONTSYD",
    name: "隔夜逆回购",
    unit: "十亿美元",
    frequency: "daily",
    group: "货币市场利率",
  },
  OBFR: {
    seriesId: "OBFR",
    name: "隔夜银行融资利率",
    unit: "%",
    frequency: "daily",
    group: "货币市场利率",
  },
  SOFR: {
    seriesId: "SOFR",
    name: "有担保隔夜融资利率",
    unit: "%",
    frequency: "daily",
    group: "货币市场利率",
  },
  SOFRVOL: {
    seriesId: "SOFRVOL",
    name: "SOFR 成交量",
    unit: "十亿美元",
    frequency: "daily",
    group: "货币市场利率",
  },
  T10Y2Y: {
    seriesId: "T10Y2Y",
    name: "10-2年期国债收益率差",
    unit: "%",
    frequency: "daily",
    group: "货币市场利率",
  },
  DISCOUNT_WINDOW: {
    seriesId: "WLCFLPCL",
    name: "贴现窗口贷款",
    unit: "百万美元",
    frequency: "weekly",
    group: "流动性工具使用",
  },
  CENTRAL_BANK_SWAPS: {
    seriesId: "SWPT",
    name: "央行货币互换余额",
    unit: "百万美元",
    frequency: "weekly",
    group: "流动性工具使用",
  },
  RESERVE_BALANCES: {
    seriesId: "WRBWFRBL",
    name: "美联储准备金",
    unit: "百万美元",
    frequency: "weekly",
    group: "准备金与黄金",
  },
  SRF: {
    seriesId: "RPONTSYD",
    name: "常备回购便利",
    unit: "十亿美元",
    frequency: "daily",
    group: "流动性工具使用",
  },
  GOLD_EFP: {
    seriesId: "GOLD_EFP",
    name: "黄金期货 EFP（期货现货互换）",
    unit: "合约数",
    frequency: "daily",
    group: "黄金期货",
  },
  GOLD_EFR: {
    seriesId: "GOLD_EFR",
    name: "黄金期货 EFR（风险互换）",
    unit: "合约数",
    frequency: "daily",
    group: "黄金期货",
  },
  GOLD_TAS: {
    seriesId: "GOLD_TAS",
    name: "黄金期货 TAS（结算时交易）",
    unit: "合约数",
    frequency: "daily",
    group: "黄金期货",
  },
  GOLD_DELIVERIES: {
    seriesId: "GOLD_DELIVERIES",
    name: "黄金期货交割量",
    unit: "1 Unit = 100 Ounce",
    frequency: "daily",
    group: "黄金期货",
  },
  VIX: {
    seriesId: "VIXCLS",
    name: "VIX 恐慌指数",
    unit: "点",
    frequency: "daily",
    group: "风险指标",
  },
  MOVE: {
    seriesId: "MOVE",
    name: "MOVE 债券波动率指数",
    unit: "bps",
    frequency: "daily",
    group: "风险指标",
  },
  US_CDS_5Y: {
    seriesId: "US_CDS_5Y",
    name: "美国5年信用违约互换",
    unit: "bps",
    frequency: "daily",
    group: "风险指标",
  },
};

/**
 * 获取 FRED 数据
 */
export async function getFREDData(
  seriesId: string,
  apiKey: string
): Promise<FREDObservation[]> {
  try {
    const response = await axios.get<FREDSeriesResponse>(
      `${FRED_API_BASE_URL}/series/observations`,
      {
        params: {
          series_id: seriesId,
          api_key: apiKey,
          file_type: "json",
          sort_order: "desc",
          limit: 10,
        },
      }
    );

    // Filter out missing values (FRED uses "." for missing data)
    const obs = (response.data.observations || []).filter(
      (o) => o.value !== "."
    );
    return obs;
  } catch (error) {
    console.error(`Failed to fetch FRED data for ${seriesId}:`, error);
    return [];
  }
}

/**
 * 风险等级判断函数
 */
export function determineRiskLevel(
  indicatorType: string,
  currentValue: number,
  previousValue?: number
): "normal" | "caution" | "warning" {
  // 根据指标类型和数值判断风险等级
  switch (indicatorType) {
    case "ONRRP":
      // 隔夜逆回购：归零代表警告，下降代表注意
      if (currentValue === 0) return "warning";
      if (previousValue !== undefined && currentValue < previousValue * 0.9)
        return "caution";
      return "normal";

    case "OBFR":
    case "SOFR":
      // 银行融资利率：飙升代表警告
      if (currentValue > 5) return "warning";
      if (currentValue > 4) return "caution";
      return "normal";

    case "SOFRVOL":
      // SOFR 成交量：暴增代表警告
      if (previousValue && currentValue > previousValue * 1.5) return "warning";
      if (previousValue && currentValue > previousValue * 1.2) return "caution";
      return "normal";

    case "T10Y2Y":
      // 10-2年期收益率差：负值代表警告（经济衰退信号）
      if (currentValue < 0) return "warning";
      if (currentValue < 0.5) return "caution";
      return "normal";

    case "DISCOUNT_WINDOW":
    case "CENTRAL_BANK_SWAPS":
    case "SRF":
      // 流动性工具：使用增加代表警告
      if (previousValue && currentValue > previousValue * 2) return "warning";
      if (previousValue && currentValue > previousValue * 1.5) return "caution";
      return "normal";

    case "RESERVE_BALANCES":
      // 准备金：下降代表警告
      if (previousValue && currentValue < previousValue * 0.95) return "warning";
      if (previousValue && currentValue < previousValue * 0.98) return "caution";
      return "normal";

    case "VIX":
      if (currentValue > 40) return "warning";
      if (currentValue > 30) return "caution";
      return "normal";

    case "MOVE":
      if (currentValue > 150) return "warning";
      if (currentValue > 120) return "caution";
      return "normal";

    case "US_CDS_5Y":
      if (currentValue > 60) return "warning";
      if (currentValue > 45) return "caution";
      return "normal";

    default:
      return "normal";
  }
}

/**
 * 风险描述
 */
export const RISK_DESCRIPTIONS: Record<string, string> = {
  ONRRP:
    "隔夜逆回购下降代表资金离开货币基金市场，归零代表市场缺乏流动性",
  OBFR: "隔夜银行融资利率飙升代表现金荒或银行间信任危机",
  SOFR: "有担保隔夜融资利率飙升代表金融机构间信任危机",
  SOFRVOL: "SOFR 成交量暴增代表金融机构发生现金荒",
  T10Y2Y: "负转正就是美国经济衰退迹象，需要密切关注",
  DISCOUNT_WINDOW: "贴现窗口贷款增加反映商业银行有短期资金需求",
  CENTRAL_BANK_SWAPS: "央行货币互换余额增加代表美元流动性短缺",
  SRF: "常备回购便利数额增加代表国债与证券交易商有融资需求",
  RESERVE_BALANCES: "美联储准备金下降代表银行在金融体系的稳定性下降",
  GOLD_EFP: "黄金期货 EFP 增加代表投资基金或央行对实物黄金需求上升",
  GOLD_EFR: "黄金期货 EFR 增加代表对黄金风险对冲的需求增加",
  GOLD_TAS: "黄金期货 TAS 增加代表结算时的交易活动增加",
  GOLD_DELIVERIES: "黄金期货交割量增加代表投资基金或央行对实物黄金需求上升",
  VIX: "VIX 高于 30 代表市场恐慌，高于 40 代表极度恐慌，低于 20 为正常",
  MOVE: "MOVE 高于 120 代表美债市场波动剧烈，高于 150 为极度异常",
  US_CDS_5Y: "美国主权5年CDS上升代表市场对美国违约风险的担忧增加",
};
