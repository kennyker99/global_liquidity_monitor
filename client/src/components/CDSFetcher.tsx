/**
 * CDSFetcher — 隐藏组件
 * 通过服务端代理获取 worldgovernmentbonds.com 的 HTML，
 * 在隐藏 iframe 中渲染（触发 JS 执行），等待数值填充后解析并写入数据库。
 *
 * 由于 worldgovernmentbonds.com 的 CDS 数值是 JS 动态渲染的，
 * 服务端无法直接获取，只能借助浏览器环境执行 JS 后读取。
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface CDSFetcherProps {
  /** 获取成功后回调 */
  onSuccess?: (value: string, date: string) => void;
  /** 是否自动触发（默认 false，需要外部调用 trigger） */
  autoFetch?: boolean;
}

export function useCDSFetcher() {
  const [isLoading, setIsLoading] = useState(false);
  const [lastValue, setLastValue] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateCDSMutation = trpc.indicators.updateCDS.useMutation({
    onSuccess: () => {
      console.log("[CDSFetcher] CDS data saved to database");
    },
    onError: (err) => {
      console.error("[CDSFetcher] Failed to save CDS:", err);
    },
  });

  // 直接 fetch worldgovernmentbonds.com 通过服务端代理
  const fetchCDS = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      // 方案1：通过服务端代理获取原始 HTML（数值为 ----）
      // 方案2：直接在前端 fetch worldgovernmentbonds.com（可能有 CORS 限制）
      // 方案3：使用 postMessage 从 iframe 获取数值

      // 尝试直接 fetch（浏览器端，无 CORS 问题因为是 same-origin 代理）
      const response = await fetch("/api/cds-proxy");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();

      // 创建临时 DOM 解析 HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // 尝试从 HTML 中找到 CDS 数值
      // worldgovernmentbonds 使用 data-async-variable 属性
      const asyncEls = doc.querySelectorAll("[data-async-variable]");
      let cdsValue: string | null = null;

      asyncEls.forEach((el) => {
        const attr = el.getAttribute("data-async-variable") || "";
        if (attr.includes("ultimoValore") || attr.includes("result.value")) {
          const text = el.textContent?.trim();
          if (text && text !== "----" && !isNaN(parseFloat(text))) {
            cdsValue = text;
          }
        }
      });

      if (cdsValue && cdsValue !== "----") {
        const today = new Date().toISOString().slice(0, 10);
        setLastValue(cdsValue);
        setLastDate(today);
        await updateCDSMutation.mutateAsync({
          value: cdsValue,
          date: today,
        });
        toast.success(`US 5Y CDS 已更新: ${cdsValue} bps`);
      } else {
        // 数值是动态渲染的，无法从静态 HTML 获取
        // 使用 iframe 方案
        await fetchCDSViaIframe();
      }
    } catch (err) {
      console.error("[CDSFetcher] Direct fetch failed:", err);
      await fetchCDSViaIframe();
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCDSViaIframe = async (): Promise<void> => {
    return new Promise((resolve) => {
      // 创建隐藏 iframe
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px;left:-9999px;";
      iframe.sandbox.add("allow-scripts", "allow-same-origin");
      document.body.appendChild(iframe);
      iframeRef.current = iframe;

      // 超时处理
      timeoutRef.current = setTimeout(() => {
        cleanup();
        console.warn("[CDSFetcher] iframe timeout, CDS not updated");
        resolve();
      }, 15000);

      const cleanup = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        iframeRef.current = null;
      };

      // 监听 iframe 加载完成
      iframe.onload = () => {
        try {
          // 等待 JS 执行（worldgovernmentbonds 使用 setTimeout 填充数值）
          setTimeout(() => {
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (!iframeDoc) {
                cleanup();
                resolve();
                return;
              }

              // 查找 CDS 数值元素
              const asyncEls = iframeDoc.querySelectorAll("[data-async-variable]");
              let cdsValue: string | null = null;

              asyncEls.forEach((el) => {
                const attr = el.getAttribute("data-async-variable") || "";
                if (attr.includes("ultimoValore")) {
                  const text = el.textContent?.trim();
                  if (text && text !== "----" && !isNaN(parseFloat(text))) {
                    cdsValue = text;
                  }
                }
              });

              if (cdsValue) {
                const today = new Date().toISOString().slice(0, 10);
                setLastValue(cdsValue);
                setLastDate(today);
                updateCDSMutation.mutateAsync({
                  value: cdsValue,
                  date: today,
                }).then(() => {
                  toast.success(`US 5Y CDS 已更新: ${cdsValue} bps`);
                });
              }

              cleanup();
              resolve();
            } catch (e) {
              console.warn("[CDSFetcher] iframe content access failed (CORS):", e);
              cleanup();
              resolve();
            }
          }, 3000);
        } catch (e) {
          cleanup();
          resolve();
        }
      };

      // 加载 worldgovernmentbonds.com
      iframe.src = "https://www.worldgovernmentbonds.com/cds-historical-data/united-states/5-years/";
    });
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (iframeRef.current?.parentNode) {
        iframeRef.current.parentNode.removeChild(iframeRef.current);
      }
    };
  }, []);

  return { fetchCDS, isLoading, lastValue, lastDate };
}

export function CDSFetcher({ onSuccess, autoFetch = false }: CDSFetcherProps) {
  const { fetchCDS, isLoading } = useCDSFetcher();

  useEffect(() => {
    if (autoFetch) {
      fetchCDS();
    }
  }, [autoFetch]);

  return null; // 纯逻辑组件，无 UI
}
