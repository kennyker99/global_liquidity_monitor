import { describe, it, expect } from "vitest";
import { getFREDData } from "./fredClient";

describe("FRED API Client", { timeout: 30000 }, () => {
  it("should fetch data from FRED API with valid API key", async () => {
    const apiKey = process.env.FRED_API_KEY;

    if (!apiKey) {
      throw new Error(
        "FRED_API_KEY environment variable is not set. Please configure it."
      );
    }

    console.log("Testing FRED API with key:", apiKey.substring(0, 8) + "...");

    // 使用一个简单的序列 ID 测试 API 连接
    let observations;
    try {
      observations = await getFREDData("SOFR", apiKey, 10, "desc");
      console.log("API call successful, received", observations.length, "observations");
    } catch (error) {
      console.error("API call failed:", error);
      throw error;
    }

    expect(observations).toBeDefined();
    expect(Array.isArray(observations)).toBe(true);
    expect(observations.length).toBeGreaterThan(0);

    // 验证观察数据的结构
    const firstObservation = observations[0];
    expect(firstObservation).toHaveProperty("date");
    expect(firstObservation).toHaveProperty("value");
    expect(firstObservation.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD 格式
    expect(firstObservation.value).toBeDefined();
  });
});
