/**
 * Read the latest COMEX gold and silver EFP/EFR/TAS/delivery totals from CME's
 * public Daily Bulletin (PG62). The bulletin PDF is updated during the trading
 * day and is accessible from Railway, unlike the page's browser-only API.
 */

import axios from "axios";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const CME_METALS_BULLETIN_URL =
  "https://www.cmegroup.com/daily_bulletin/current/Section62_Metals_Futures_Products.pdf";

export interface PreciousMetalMetrics {
  date: string;
  efp: number;
  efr: number;
  tas: number;
  deliveries: number;
}

export interface CMEPreciousMetalsSnapshot {
  gold: PreciousMetalMetrics;
  silver: PreciousMetalMetrics;
}

interface PositionedText {
  x: number;
  text: string;
}

function normalizeNumber(value: string | undefined): number {
  if (!value || value === "---" || value === "-") return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTradeDate(pageLines: Map<number, PositionedText[]>): string {
  const text = Array.from(pageLines.values()).flat().map((item) => item.text).join(" ");
  const match = text.match(
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})/
  );
  if (!match) throw new Error("CME bulletin trade date was not found");
  const month = new Date(`${match[1]} 1, 2000 UTC`).getUTCMonth() + 1;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function getContractTotals(
  lines: Map<number, PositionedText[]>,
  metal: "GOLD" | "SILVER"
): Omit<PreciousMetalMetrics, "date"> | null {
  const totals = { efp: 0, efr: 0, tas: 0, deliveries: 0 };
  let inMetalSection = false;
  let foundMetalSection = false;

  for (const [, rawItems] of Array.from(lines.entries()).sort((a, b) => b[0] - a[0])) {
    const items = [...rawItems].sort((a, b) => a.x - b.x);
    const lineText = items.map((item) => item.text).join(" ").toUpperCase();

    if (lineText.includes(`COMEX ${metal} FUTURES`)) {
      inMetalSection = true;
      foundMetalSection = true;
      continue;
    }
    const isContractRow = /^[A-Z]{3}\d{2}$/.test(items[0]?.text.trim() ?? "");
    if (inMetalSection && !isContractRow && !lineText.startsWith("TOTAL")) break;
    if (!inMetalSection || !isContractRow) {
      continue;
    }

    for (const item of items.slice(1)) {
      const value = normalizeNumber(item.text.trim());
      if (item.x >= 55 && item.x < 90) totals.deliveries += value;
      else if (item.x >= 140 && item.x < 180) totals.efp += value;
      else if (item.x >= 305 && item.x < 350) totals.efr += value;
      else if (item.x >= 495 && item.x < 545) totals.tas += value;
    }
  }

  if (!foundMetalSection) return null;
  return totals;
}

/** Fetch and parse the latest public CME PG62 bulletin. */
export async function fetchLatestCMEPreciousMetals(): Promise<CMEPreciousMetalsSnapshot> {
  const response = await axios.get<ArrayBuffer>(CME_METALS_BULLETIN_URL, {
    responseType: "arraybuffer",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GlobalLiquidityMonitor/1.0)",
      Accept: "application/pdf,*/*",
    },
    timeout: 30000,
  });

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(response.data) }).promise;
  if (pdf.numPages === 0) {
    throw new Error("Unexpected CME metals bulletin: PDF has no pages");
  }

  let date: string | undefined;
  let goldTotals: Omit<PreciousMetalMetrics, "date"> | null = null;
  let silverTotals: Omit<PreciousMetalMetrics, "date"> | null = null;

  // CME's daily bulletin can shift sections between pages as products are added
  // or removed. Scan each page instead of relying on a fixed PDF page number.
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = new Map<number, PositionedText[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const line = lines.get(y) ?? [];
      line.push({ x: Math.round(item.transform[4]), text: item.str });
      lines.set(y, line);
    }

    if (pageNumber === 1) date = getTradeDate(lines);
    goldTotals ??= getContractTotals(lines, "GOLD");
    silverTotals ??= getContractTotals(lines, "SILVER");
    if (goldTotals && silverTotals) break;
  }

  if (!date) throw new Error("CME bulletin trade date was not found");
  if (!goldTotals) throw new Error("COMEX GOLD section not found in CME bulletin");
  if (!silverTotals) throw new Error("COMEX SILVER section not found in CME bulletin");

  const gold = { date, ...goldTotals };
  const silver = { date, ...silverTotals };
  console.log(
    `[CME Bulletin] ${date}: Gold EFP=${gold.efp} EFR=${gold.efr} TAS=${gold.tas} deliveries=${gold.deliveries}; ` +
      `Silver EFP=${silver.efp} EFR=${silver.efr} TAS=${silver.tas} deliveries=${silver.deliveries}`
  );
  return { gold, silver };
}
