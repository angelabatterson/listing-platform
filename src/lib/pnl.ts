// The year-end profit and loss summary: a seller's sales for one calendar year added up
// by month and by store, as a PDF to hand to an accountant.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { SaleMoney } from "@/lib/sales-table";

export type PnlLine = {
  orders: number;
  sales: number;
  shipping: number;
  refunds: number;
  fees: number;
  shippingCosts: number;
  cogs: number;
  other: number;
  profit: number;
  tax: number;
};

export type Pnl = {
  year: number;
  months: PnlLine[];
  stores: { name: string; line: PnlLine }[];
  total: PnlLine;
  missingCost: number;
  estimatedFees: number;
};

const empty = (): PnlLine => ({ orders: 0, sales: 0, shipping: 0, refunds: 0, fees: 0, shippingCosts: 0, cogs: 0, other: 0, profit: 0, tax: 0 });

function add(line: PnlLine, m: SaleMoney) {
  line.orders += 1;
  line.sales += m.price;
  line.shipping += m.shipping;
  line.refunds += m.refund;
  line.fees += m.fees;
  line.shippingCosts += m.shippingCost;
  line.cogs += m.cost;
  line.other += m.other;
  line.profit += m.profit;
  line.tax += m.tax;
}

// Add up sales (each with its sold date, store name and money) for `year`. Sales from
// other years are left out.
export function summarizeYear(year: number, rows: { soldAt: Date; store: string; money: SaleMoney }[]): Pnl {
  const months = Array.from({ length: 12 }, empty);
  const byStore = new Map<string, PnlLine>();
  const total = empty();
  let missingCost = 0;
  let estimatedFees = 0;
  for (const r of rows) {
    if (r.soldAt.getUTCFullYear() !== year) continue;
    add(months[r.soldAt.getUTCMonth()], r.money);
    if (!byStore.has(r.store)) byStore.set(r.store, empty());
    add(byStore.get(r.store)!, r.money);
    add(total, r.money);
    if (!r.money.costKnown) missingCost += 1;
    if (r.money.feesEstimated) estimatedFees += 1;
  }
  const stores = [...byStore.entries()].map(([name, line]) => ({ name, line })).sort((a, b) => b.line.sales - a.line.sales);
  return { year, months, stores, total, missingCost, estimatedFees };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const COLUMNS: { heading: string[]; value: (l: PnlLine) => string }[] = [
  { heading: ["Orders", ""], value: (l) => String(l.orders) },
  { heading: ["Sales", ""], value: (l) => money(l.sales) },
  { heading: ["Shipping", "charged"], value: (l) => money(l.shipping) },
  { heading: ["Refunds", ""], value: (l) => money(-l.refunds) },
  { heading: ["Store", "fees"], value: (l) => money(-l.fees) },
  { heading: ["Shipping", "labels"], value: (l) => money(-l.shippingCosts) },
  { heading: ["Cost of", "goods"], value: (l) => money(-l.cogs) },
  { heading: ["Other", "costs"], value: (l) => money(-l.other) },
  { heading: ["Profit", ""], value: (l) => money(l.profit) },
];

export function money(cents: number): string {
  const abs = Math.abs(cents);
  const text = `$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `(${text})` : text;
}

// The standard PDF fonts only know Western characters; anything else (like emoji in a
// shop name) would stop the PDF from being made.
const printable = (s: string) => s.replace(/[^\x20-\x7e -ÿ]/g, "?");

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.85, 0.85, 0.87);
const BAND = rgb(0.96, 0.96, 0.97);

export async function pnlPdf(pnl: Pnl, business: string, made = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${printable(business)} profit and loss ${pnl.year}`);
  pdf.setCreator("Relistic");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([792, 612]); // US Letter, landscape
  const left = 40;
  const right = 752;
  let y = 572;

  const text = (s: string, x: number, at: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; alignRight?: boolean } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9;
    const clean = printable(s);
    const width = font.widthOfTextAtSize(clean, size);
    page.drawText(clean, { x: opts.alignRight ? x - width : x, y: at, size, font, color: opts.color ?? INK });
  };

  text(printable(business), left, y, { font: bold, size: 18 });
  y -= 20;
  text(`Profit and loss, January 1 to December 31, ${pnl.year}`, left, y, { size: 11, color: MUTED });
  text(`Made ${made.toISOString().slice(0, 10)} with Relistic`, right, y, { size: 9, color: MUTED, alignRight: true });
  y -= 26;

  // Headline numbers.
  const t = pnl.total;
  const income = t.sales + t.shipping - t.refunds;
  const costs = t.fees + t.shippingCosts + t.cogs + t.other;
  const headline: [string, string][] = [
    ["Income (sales + shipping - refunds)", money(income)],
    ["Costs (fees, labels, goods, other)", money(-costs)],
    ["Profit", money(t.profit)],
    ["Orders", String(t.orders)],
  ];
  const boxW = (right - left - 30) / 4;
  headline.forEach(([label, value], i) => {
    const x = left + i * (boxW + 10);
    page.drawRectangle({ x, y: y - 34, width: boxW, height: 44, color: BAND });
    text(label, x + 8, y - 2, { size: 8, color: MUTED });
    text(value, x + 8, y - 24, { font: bold, size: 15 });
  });
  y -= 60;

  const firstCol = 120;
  const colW = (right - left - firstCol) / COLUMNS.length;
  const table = (title: string, rows: { name: string; line: PnlLine }[], totalRow: PnlLine | null) => {
    text(title, left, y, { font: bold, size: 11 });
    y -= 16;
    COLUMNS.forEach((c, i) => {
      const x = left + firstCol + colW * (i + 1) - 4;
      text(c.heading[0], x, y, { font: bold, size: 8, color: MUTED, alignRight: true });
      if (c.heading[1]) text(c.heading[1], x, y - 9, { font: bold, size: 8, color: MUTED, alignRight: true });
    });
    y -= 14;
    line(page, left, right, y + 1);
    const row = (name: string, l: PnlLine, font: PDFFont) => {
      y -= 12;
      text(name, left + 2, y, { font, size: 8.5 });
      COLUMNS.forEach((c, i) => text(c.value(l), left + firstCol + colW * (i + 1) - 4, y, { font, size: 8.5, alignRight: true }));
    };
    for (const r of rows) row(r.name, r.line, regular);
    if (totalRow) {
      y -= 4;
      line(page, left, right, y + 1);
      row("Total", totalRow, bold);
    }
    y -= 22;
  };

  table("By month", pnl.months.map((line, i) => ({ name: MONTHS[i], line })), pnl.total);
  if (pnl.stores.length) table("By store", fewStores(pnl.stores, 6), pnl.stores.length > 1 ? pnl.total : null);

  const notes = [
    `Sales tax the stores collected and paid for you (${money(t.tax)}) is not counted as income.`,
    "Amounts in brackets are money out. Dates are the day each sale was made (UTC).",
    pnl.missingCost ? `${pnl.missingCost} sale${pnl.missingCost === 1 ? " has" : "s have"} no cost of goods entered, so profit may be higher than it really was.` : "",
    pnl.estimatedFees ? `Store fees on ${pnl.estimatedFees} sale${pnl.estimatedFees === 1 ? " are" : "s are"} Relistic's estimate; check them against your store statements.` : "",
    "This summary is to help with your records; it isn't tax advice.",
  ].filter(Boolean);
  for (const n of notes) {
    if (y < 30) break;
    text(n, left, y, { size: 8, color: MUTED });
    y -= 11;
  }

  return pdf.save();
}

// The biggest stores, with the rest added up on one row so the page still fits.
export function fewStores(stores: Pnl["stores"], most: number): Pnl["stores"] {
  if (stores.length <= most) return stores;
  const rest = empty();
  for (const { line } of stores.slice(most - 1)) {
    for (const k of Object.keys(rest) as (keyof PnlLine)[]) rest[k] += line[k];
  }
  return [...stores.slice(0, most - 1), { name: "Other stores", line: rest }];
}

function line(page: PDFPage, from: number, to: number, y: number) {
  page.drawLine({ start: { x: from, y }, end: { x: to, y }, thickness: 0.6, color: RULE });
}
