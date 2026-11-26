/**
 * PDF fonts: Geist has the ₱ glyph; the built-in PDF fonts do not.
 * Imported once by every PDF document module.
 */
import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

const FONT_DIR = path.join(process.cwd(), "node_modules", "geist", "dist", "fonts", "geist-sans");

let registered = false;

export function registerPdfFonts() {
  if (registered) return;
  registered = true;
  Font.register({
    family: "Geist",
    fonts: [
      { src: path.join(FONT_DIR, "Geist-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Geist-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "Geist-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Never split words with hyphens (names, plate numbers).
  Font.registerHyphenationCallback((word) => [word]);
}
