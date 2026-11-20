import type { Secrets } from "./secrets";
import type { PacketAttachment } from "./types";
import { InsurerRefusal } from "./types";

export const PORTAL_SCRIPT_VERSION = "2026.11.1";

/** The slice of a browser page the portal script uses. Playwright's Page adapts to this. */
export interface PortalPage {
  goto(url: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  setFiles(selector: string, files: Array<{ name: string; mimeType: string; buffer: Uint8Array }>): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  screenshot(): Promise<Uint8Array>;
}

export interface PortalSubmitInput {
  url: string;
  credentialsKey: string;
  attachments: PacketAttachment[];
  referenceSelector?: string;
}

/**
 * Log in, fill the form, upload attachments in policy order, submit, and read the confirmation.
 * The password is typed into the page and is not returned.
 */
export async function submitOnPortal(page: PortalPage, secrets: Secrets, input: PortalSubmitInput): Promise<{ reference: string; screenshot: Uint8Array; raw: string }> {
  const credentials = await secrets.get(input.credentialsKey);
  if (!credentials) throw new InsurerRefusal("auth_failed", "Sign-in failed");
  try {
    await page.goto(input.url);
    await page.fill("#username", credentials.username);
    await page.fill("#password", credentials.password);
    await page.click("#login");
    const files = input.attachments.map((item) => ({
      name: item.name,
      mimeType: "application/pdf",
      buffer: new Uint8Array(),
    }));
    await page.setFiles("#attachments", files);
    await page.click("#submit");
    const reference = (await page.textContent(input.referenceSelector ?? "#confirmation"))?.trim() ?? "";
    if (!reference) throw new InsurerRefusal("page_changed", "Page changed");
    const screenshot = await page.screenshot();
    const raw = `confirmation ${reference}`;
    return { reference, screenshot, raw };
  } catch (error) {
    if (error instanceof InsurerRefusal) throw error;
    const message = error instanceof Error ? error.message : "Portal submission failed";
    if (/captcha/i.test(message)) throw new InsurerRefusal("captcha", "Captcha");
    if (/auth|login|password/i.test(message)) throw new InsurerRefusal("auth_failed", "Sign-in failed");
    throw new InsurerRefusal("page_changed", "Page changed");
  }
}
