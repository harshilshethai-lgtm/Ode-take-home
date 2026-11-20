// One-shot generator for the fictional packet PDFs. Standard fonts only, so the text layer stays extractable.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function escapePdf(value) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pageContent(lines, options) {
  const commands = [];
  if (options.scanned) {
    commands.push("0.94 g", "0 0 612 792 re f", "0.82 g", "28 748 556 32 re f", "0.9 g", "28 40 556 22 re f", "0 g");
  }
  commands.push("BT", `/F1 ${options.headerSize ?? 9} Tf`, "36 758 Td", `(${escapePdf(options.header)}) Tj`, "ET");
  let y = options.scanned ? 720 : 730;
  for (const line of lines) {
    const size = line.startsWith("#") ? 14 : 11;
    const text = line.startsWith("#") ? line.slice(1) : line;
    commands.push("BT", `/F2 ${size} Tf`, `48 ${y} Td`, `(${escapePdf(text)}) Tj`, "ET");
    y -= size === 14 ? 22 : 16;
  }
  commands.push("BT", "/F1 8 Tf", "48 48 Td", `(${escapePdf(options.footer)}) Tj`, "ET");
  return commands.join("\n");
}

function buildPdf(pages) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>");
  const pageIds = pages.map((page) => {
    const stream = pageContent(page.lines, page);
    const contentId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    return { contentId };
  });
  const pageObjectIds = pageIds.map((page) =>
    add(
      `<< /Type /Page /Parent PAGES /MediaBox [0 0 612 792] /Contents ${page.contentId} 0 R /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> >>`,
    ),
  );
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  const pagesId = add(`<< /Type /Pages /Count ${pageObjectIds.length} /Kids [${kids}] >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body.replaceAll("PAGES", String(pagesId))} \nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function write(path, pages) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildPdf(pages));
}

const footer = "Fictional record for the Ode FDPM take-home";

write("fixtures/case-2-scott/utopia-pt.pdf", [
  {
    scanned: true,
    header: "FROM UTOPIA PLANITIA REHAB  11/10/2026 14:02  P.001/002",
    footer,
    lines: [
      "#UTOPIA PLANITIA REHAB",
      "Physical therapy progress notes",
      "",
      "Patient: Montgomery Scott",
      "DOB: 06/11/1979",
      "MRN: HH-0017042",
      "",
      "PT visits: 09/29/2026 to 11/06/2026",
      "Visits attended: 10",
      "Treatment: Therapeutic exercise, manual therapy, gait training",
      "Response: pain improved 5 to 4/10, still catching",
      "",
      "Therapist: T. Chapel, PT",
      "Signature: T. Chapel, PT",
    ],
  },
  {
    scanned: true,
    header: "FROM UTOPIA PLANITIA REHAB  11/10/2026 14:02  P.002/002",
    footer,
    lines: [
      "#Visit log",
      "09/29  evaluation, gait painful",
      "10/01  therapeutic exercise",
      "10/03  manual therapy",
      "10/06  closed chain strengthening",
      "10/08  still catching on stairs",
      "10/13  pain 5/10 at arrival",
      "10/20  pain 4/10, catching remains",
      "10/27  gait training",
      "11/03  single leg balance",
      "11/06  discharge from this course, 10 visits",
      "",
      "Patient: Montgomery Scott",
      "DOB: 06/11/1979",
      "MRN: HH-0017042",
    ],
  },
]);

write("fixtures/case-3-sulu/visit-note.pdf", [
  {
    scanned: false,
    header: "EPIC | Office visit | 11/10/2026 1:05 PM",
    footer: "Halcyon Health | Enterprise Campus",
    lines: [
      "#Office visit",
      "Patient: Hikaru Sulu",
      "DOB: 09/14/1984",
      "MRN: HH-0017058",
      "Provider: Leonard McCoy, MD",
      "",
      "Chief complaint",
      "R shoulder pain x 3 wks after fencing.",
      "",
      "History",
      "Started PT last wk. Pain with overhead reach. No recent injury.",
      "",
      "Exam",
      "Full ROM, 5/5 strength, pain w/ overhead reach.",
      "No swelling. No deformity. Sensation intact.",
      "No red flags on this exam.",
      "No trauma with weakness, no suspected cuff tear,",
      "no dislocation, no infection, and no cancer history.",
      "",
      "Assessment",
      "Right shoulder pain for 3 weeks. Therapy for 1 week.",
      "Red-flag waiver does not apply. No shoulder X-ray on record.",
    ],
  },
]);

write("fixtures/case-26-uhura/input.pdf", [
  {
    scanned: false,
    header: "FEDERATION HEALTH | Utilization management",
    footer: "Federation Health | denial letter",
    lines: [
      "#Denial of prior authorization",
      "Patient: Nyota Uhura",
      "DOB: 07/19/1959",
      "MRN: HH-0017301",
      "Date: November 9, 2026",
      "Study: MRI lumbar spine 72148",
      "Reference: FH-DEN-58340",
      "",
      "This request is denied under RAD-114 section 2b.",
      "Section 2b requires documented conservative care.",
      "The PT notes were not included.",
    ],
  },
]);

write("fixtures/case-26-uhura/pt.pdf", [
  {
    scanned: true,
    header: "FROM STARBASE PHYSICAL THERAPY  11/08/2026  P.001/001",
    footer,
    lines: [
      "#STARBASE PHYSICAL THERAPY",
      "Discharge summary",
      "",
      "Patient: Nyota Uhura",
      "DOB: 07/19/1959",
      "Dates of care: 9/21/2026 to 10/31/2026",
      "Visits: 12 attended, 0 missed",
      "Response: pain improved, still limited on the right.",
    ],
  },
]);

write("fixtures/case-26-uhura/appeal.pdf", [
  {
    scanned: false,
    header: "Halcyon Health | Appeal draft | 11/10/2026",
    footer: "Signed appeal packet",
    lines: [
      "#Appeal of denial FH-DEN-58340",
      "Patient: Nyota Uhura",
      "DOB: 07/19/1959",
      "MRN: HH-0017301",
      "",
      "The denial cited section 2b because the PT",
      "documentation was missing. Those notes are attached.",
      "Starbase Physical Therapy documents 12 visits,",
      "9/21/2026 to 10/31/2026.",
      "",
      "Please reconsider RAD-114 section 2b.",
      "",
      "Signed",
      "Christine Chapel, RN",
      "Leonard McCoy, MD",
    ],
  },
]);

write("fixtures/case-27-chekov/input.pdf", [
  {
    scanned: false,
    header: "ANDORIAN LIFE PORTAL | 11/10/2026 11:40 AM",
    footer: "Portal receipt",
    lines: [
      "#Upload failed: file > 10MB",
      "Patient: Pavel Chekov",
      "DOB: 09/19/1994",
      "MRN: HH-0017318",
      "Study: MRI shoulder right 73221",
      "",
      "The packet was 14MB. The portal stopped the upload.",
      "Compress the packet under 10MB and resubmit.",
    ],
  },
]);
