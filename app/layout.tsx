import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Hanken_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Scrape Studio",
  description: "Paste a link, mark what you want on the page, and export every page of it to Excel, CSV, JSON, or PDF.",
};

export const viewport: Viewport = { themeColor: "#e9ebee", width: "device-width", initialScale: 1 };

const CONTRACT = `
THESIS: The page you paste is a printout on the desk; you run a highlighter over what you want and each ink becomes a column. Refuses the scraper-console default: endpoint lists, selector boxes, dark dashboards.
OWN-WORLD: White office paper on a cool gray desk. Graphite ink for all type (Hanken Grotesk; JetBrains Mono only for counts and addresses). Eight fluorescent inks used only as column identity, multiplied over the words. Marker-cap swatches, hairline graphite rules, paper that lifts off the desk.
STORY: Paste a link, see the page already highlighted, click to add or strike inks, rename caps, see "10 on this page, every page available", export all of it.
FIRST VIEWPORT: URL bar across the top; the sheet on the desk, left; the marker tray, right: lists found, columns, how much, export; preview table under the sheet.
FORM: Highlighter on the Printout, first on the ordered list (pick), seed 80324f84.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div hidden dangerouslySetInnerHTML={{ __html: `<!--${CONTRACT}-->` }} />
        {children}
      </body>
    </html>
  );
}
