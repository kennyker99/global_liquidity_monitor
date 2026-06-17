/**
 * 测试 CME 黄金期货数据抓取
 */
import axios from "axios";

const CME_VOLUME_API = "https://www.cmegroup.com/CmeWS/mvc/Volume/Details/F/437";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Referer: "https://www.cmegroup.com/markets/metals/precious/gold.volume.html",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function parseIntSafe(val) {
  if (!val || val === "-") return 0;
  return parseInt(val.replace(/,/g, ""), 10) || 0;
}

function formatDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function isWeekday(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

async function fetchForDate(date) {
  const dateStr = formatDateYYYYMMDD(date);
  const isoDate = date.toISOString().split("T")[0];

  try {
    const url = `${CME_VOLUME_API}/${dateStr}/P`;
    const response = await axios.get(url, {
      headers: BROWSER_HEADERS,
      params: { tradeDate: dateStr, pageSize: 500, isProtected: "", _t: Date.now() },
      timeout: 15000,
    });

    const data = response.data;
    if (data.empty || !data.totals) {
      console.log(`  ${dateStr}: No data (empty)`);
      return null;
    }

    const t = data.totals;
    const efp = parseIntSafe(t.efpVol);
    const efr = parseIntSafe(t.efrVol);
    const tas = parseIntSafe(t.tasVol);
    const deliveries = parseIntSafe(t.deliveries);

    if (efp === 0 && efr === 0 && tas === 0 && deliveries === 0) {
      console.log(`  ${dateStr}: All zeros, skipping`);
      return null;
    }

    console.log(`  ${dateStr}: EFP=${efp}, EFR=${efr}, TAS=${tas}, Deliveries=${deliveries}`);
    return { date: isoDate, efp, efr, tas, deliveries };
  } catch (e) {
    if (e.response?.status === 404) {
      console.log(`  ${dateStr}: 404 Not Found`);
    } else {
      console.log(`  ${dateStr}: Error - ${e.message}`);
    }
    return null;
  }
}

async function main() {
  console.log("Testing CME Gold Futures data fetch...\n");

  const results = [];
  let cursor = new Date();
  cursor.setDate(cursor.getDate() - 1);

  let attempts = 0;
  while (results.length < 6 && attempts < 15) {
    if (isWeekday(cursor)) {
      const r = await fetchForDate(new Date(cursor));
      if (r) results.push(r);
      await new Promise(res => setTimeout(res, 400));
    }
    cursor.setDate(cursor.getDate() - 1);
    attempts++;
  }

  console.log(`\nFetched ${results.length} records:`);
  console.table(results);
}

main().catch(console.error);
