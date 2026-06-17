import { trpc } from "@/lib/trpc";

interface MOVEData {
  value: string;
  previousValue: string;
  date: string;
  changeValue: string;
  changePercent: string;
}

/**
 * MOVE Index hook。
 *
 * 重要：不再从浏览器直接请求 Yahoo Finance —— query1.finance.yahoo.com 不返回
 * CORS 头，浏览器 fetch 必定失败。改为调用后端 tRPC 接口 indicators.getMOVE
 * （同源，无 CORS 问题），由服务端用 crumb 认证抓取 Yahoo。
 */
export function useMOVE(): { data: MOVEData | null; isLoading: boolean } {
  const { data: quote, isLoading } = trpc.indicators.getMOVE.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: 1,
    staleTime: 5 * 60 * 1000, // 5 分钟内不重复请求
  });

  if (!quote) {
    return { data: null, isLoading };
  }

  // change / changePercent 可能为 null —— 即使如此，只要 price 有值就显示
  const data: MOVEData = {
    value: quote.price.toFixed(2),
    previousValue:
      quote.change !== null ? (quote.price - quote.change).toFixed(2) : quote.price.toFixed(2),
    date: quote.updatedAt,
    changeValue: quote.change !== null ? quote.change.toFixed(4) : "",
    changePercent: quote.changePercent !== null ? quote.changePercent.toFixed(2) : "",
  };

  return { data, isLoading };
}
