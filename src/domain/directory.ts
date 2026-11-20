// Phones, faxes and NPIs for offices named on a packet.
// A number is stored here only when a cover sheet or an outreach record already has it.

export interface DirectoryContact {
  name: string;
  phone?: string;
  fax?: string;
  npi?: string;
}

const CONTACTS: DirectoryContact[] = [
  { name: "Leonard McCoy, MD", phone: "(410) 555-0188", fax: "(210) 555-0160", npi: "1700000017" },
  { name: "Utopia Planitia Rehab", fax: "(210) 555-0144" },
  { name: "Promenade Urgent Care", phone: "555-0148" },
  { name: "Bashir-Mora, MD", fax: "(210) 555-0188", phone: "(410) 555-0109" },
  { name: "W. Crusher, MD", fax: "(210) 555-0172" },
];

/** Match a packet or reason string to a directory card. */
export function contactFor(name: string | null | undefined): DirectoryContact | null {
  if (!name) return null;
  const text = name.toLowerCase();
  if (text.includes("mccoy")) return CONTACTS[0] ?? null;
  if (text.includes("utopia")) return CONTACTS[1] ?? null;
  if (text.includes("promenade")) return CONTACTS[2] ?? null;
  if (text.includes("bashir")) return CONTACTS[3] ?? null;
  if (text.includes("crusher")) return CONTACTS[4] ?? null;
  return null;
}
