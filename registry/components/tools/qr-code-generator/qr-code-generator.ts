import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";
import QRCode from "qrcode";

export const qrCodeGeneratorTool = tool({
  description: "Generate a QR code as an SVG string from text or a URL",
  inputSchema: z.object({
    text: z.string().describe("Text or URL to encode in the QR code"),
    width: z.number().default(256).describe("Width of the QR code in pixels"),
    margin: z.number().default(2).describe("Quiet zone margin"),
    errorCorrection: z.enum(["L", "M", "Q", "H"]).default("M").describe("Error correction level"),
  }),
  execute: async ({ text, width, margin, errorCorrection }) => {
    const svg = await QRCode.toString(text, { type: "svg", width, margin, errorCorrectionLevel: errorCorrection });
    const dataUri = `data:image/svg+xml;base64,${btoa(svg)}`;
    return { svg, dataUri, text, width };
  },
});

registerTool({
  name: "qr-code-generator",
  description: "Generate a QR code as an SVG string from text or a URL",
  inputSchema: z.object({ text: z.string(), width: z.number().default(256), margin: z.number().default(2), errorCorrection: z.enum(["L", "M", "Q", "H"]).default("M") }),
  tool: qrCodeGeneratorTool,
});
