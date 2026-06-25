import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const STAMP_PATH = fileURLToPath(new URL("../../assets/taxmate-stamp.png", import.meta.url));

const GREEN = "#04763b";
const GREEN_DARK = "#07552f";
const DARK = "#1b1f1a";
const MUTED = "#6b7280";
const BORDER = "#e2e5dc";
const ACCENT = "#e8f5ec";

export interface ReceiptData {
  invoiceId: string;
  status: string;
  tin: string;
  taxItem: string;
  category: string | null;
  amount: string;
  paymentReference: string | null;
  paidAt: string | null;
  confirmedAt: string | null;
  blockchain: { network: string; contract: string | null; txHash: string | null; explorerUrl: string | null };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

// Standard PDF fonts don't include the ₦ glyph; render "NGN" instead.
function money(amount: string): string {
  return amount.replace(/₦/g, "NGN ");
}

export function generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const M = 50;
    const contentW = pageW - M * 2;
    const hasStamp = existsSync(STAMP_PATH);

    // ---- Header band ----
    doc.rect(0, 0, pageW, 132).fill(GREEN);
    if (hasStamp) {
      doc.image(STAMP_PATH, M, 30, { width: 72, height: 72 });
    }
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(26).text("TAXMATE", M + 88, 42);
    doc.font("Helvetica").fontSize(12).fillColor("#d6ecde").text("Tax Payment Receipt", M + 90, 74);
    doc.fontSize(10).fillColor("#bfe2cd").text("taxmate.ng", M + 90, 92);

    // Status pill (top right)
    const status = data.status.toUpperCase();
    const pillW = doc.widthOfString(status) + 24;
    const pillX = pageW - M - pillW;
    doc.roundedRect(pillX, 50, pillW, 24, 12).fill("#ffffff");
    doc.fillColor(GREEN_DARK).font("Helvetica-Bold").fontSize(10).text(status, pillX, 57, { width: pillW, align: "center" });

    let y = 168;

    // ---- Amount ----
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(10).text("AMOUNT PAID", M, y);
    doc.fillColor(DARK).font("Helvetica-Bold").fontSize(32).text(money(data.amount), M, y + 14);
    y += 70;

    // ---- Details table ----
    const rows: [string, string][] = [
      ["Tax Item", data.taxItem],
      ["Category", data.category ?? "—"],
      ["Taxpayer TIN", data.tin],
      ["Payment Reference", data.paymentReference ?? "—"],
      ["Paid At", fmtDate(data.paidAt)],
      ["Confirmed At", fmtDate(data.confirmedAt)],
      ["Invoice ID", data.invoiceId]
    ];

    doc.lineWidth(1).strokeColor(BORDER);
    for (const [label, value] of rows) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(label, M, y + 5, { width: 150 });
      doc.fillColor(DARK).font("Helvetica-Bold").fontSize(11).text(value, M + 160, y + 4, { width: contentW - 160, align: "right" });
      y += 28;
      doc.moveTo(M, y).lineTo(M + contentW, y).stroke();
    }

    y += 24;

    // ---- Blockchain verification box ----
    const boxH = 116;
    doc.roundedRect(M, y, contentW, boxH, 12).fill(ACCENT);
    doc.fillColor(GREEN_DARK).font("Helvetica-Bold").fontSize(11).text("ON-CHAIN VERIFICATION", M + 18, y + 16);
    const bc = data.blockchain;
    const bcRows: [string, string][] = [
      ["Network", bc.network],
      ["Contract", bc.contract ?? "—"],
      ["Transaction", bc.txHash ?? "—"]
    ];
    let by = y + 38;
    for (const [label, value] of bcRows) {
      doc.fillColor(GREEN_DARK).font("Helvetica").fontSize(9).text(label, M + 18, by, { width: 80 });
      doc.fillColor(DARK).font("Courier").fontSize(8.5).text(value, M + 100, by, { width: contentW - 118 });
      by += 22;
    }

    y += boxH + 36;

    // ---- Stamp + signature area ----
    if (hasStamp) {
      doc.save();
      doc.opacity(0.9);
      doc.image(STAMP_PATH, pageW - M - 110, y, { width: 110, height: 110 });
      doc.opacity(1);
      doc.restore();
      doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8).text("Taxmate.ng • Verified", pageW - M - 120, y + 114, { width: 130, align: "center" });
    }

    doc.fillColor(DARK).font("Helvetica-Bold").fontSize(11).text("Authorised by Taxmate", M, y + 70);
    doc.moveTo(M, y + 66).lineTo(M + 180, y + 66).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("This is a system-generated receipt. Payment evidence is anchored on-chain and independently verifiable via the transaction hash above.", M, y + 92, { width: 300 });

    // ---- Footer ----
    const footY = doc.page.height - 50;
    doc.moveTo(M, footY).lineTo(M + contentW, footY).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("Taxmate — Modern tax compliance for Nigeria", M, footY + 8);
    doc.text("taxmate.ng", M, footY + 8, { width: contentW, align: "right" });

    doc.end();
  });
}
