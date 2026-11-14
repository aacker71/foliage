/** Portable Word presentation of the admitted projection. No private document lookup. */
import { distributionProjection, type PublishedLeafDocument } from "@foliage/canopy";
import { ACHIEVEMENT_CLAIM_LABELS } from "@foliage/leaf";
import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

const textRun = (text: string, bold = false) => new TextRun({ text, bold });
const linked = (text: string, url: string) => new ExternalHyperlink({
  link: url, children: [new TextRun({ text, style: "Hyperlink" })],
});
const paragraph = (text: string) => new Paragraph({ widowControl: true, children: text.split(/\r\n|\r|\n/).map((line, i) =>
  new TextRun({ text: line, ...(i ? { break: 1 } : {}) })) });

export async function publicResumeDocx(document: PublishedLeafDocument, origin: string): Promise<Buffer> {
  const view = distributionProjection(document, origin);
  // Refuse XML-invalid content instead of silently changing the person's statement.
  const check = (value: unknown): void => {
    if (typeof value === "string" && /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(value)) {
      throw new Error("The published text contains characters that cannot be represented in a Word document.");
    }
    if (value && typeof value === "object") for (const item of Object.values(value)) check(item);
  };
  check(view);
  const children: Paragraph[] = [new Paragraph({ text: view.subject.name, heading: HeadingLevel.TITLE })];
  if (view.headline) children.push(paragraph(view.headline));
  children.push(new Paragraph({ children: [textRun("Portfolio and evidence: "), linked(view.url, view.url)] }));
  for (const introduction of [view.bio, view.direction]) if (introduction) children.push(paragraph(introduction));
  children.push(new Paragraph({ text: "Selected work", heading: HeadingLevel.HEADING_1 }));
  for (const achievement of view.achievements) {
    children.push(new Paragraph({ text: achievement.title, heading: HeadingLevel.HEADING_2 }));
    for (const claim of achievement.claims) {
      children.push(new Paragraph({ children: [textRun(ACHIEVEMENT_CLAIM_LABELS[claim.kind], true)], keepNext: true }));
      children.push(paragraph(claim.text));
      children.push(new Paragraph({ children: [linked("Read this statement in the portfolio", claim.url)] }));
      for (const [index, citation] of claim.citations.entries()) children.push(new Paragraph({ children: [
        linked(`Evidence ${index + 1}`, citation.url), textRun(` — ${citation.source}`),
      ] }));
    }
  }
  if (!view.achievements.length) children.push(paragraph("No achievement statements have been published yet. The portfolio may contain other shared work."));
  children.push(paragraph(`Published ${view.publishedAt.slice(0, 10)}`), paragraph(view.limitation),
    paragraph("This download is a snapshot. Follow the portfolio links for current work and availability."));
  // A document uses portable office fonts, not runtime font downloads or a screenshot.
  const file = new Document({
    title: `${view.subject.name} Résumé`, creator: "Foliage", lastModifiedBy: "Foliage",
    description: "Published work with portfolio and evidence links", revision: 1,
    styles: { default: {
      document: { run: { font: "Arial", size: 22, color: "000000" }, paragraph: { spacing: { after: 120, line: 276 } } },
      title: { run: { font: "Arial", size: 44, color: "000000" }, paragraph: { spacing: { after: 180 }, keepNext: true } },
      heading1: { run: { font: "Arial", size: 28, bold: true, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
      heading2: { run: { font: "Arial", size: 24, bold: true, color: "000000" }, paragraph: { spacing: { before: 180, after: 120 }, keepNext: true } },
      hyperlink: { run: { color: "000000", underline: {} } },
    } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children }],
  });
  return Packer.toBuffer(file);
}
