/** A WhatsApp share link with the text and no phone number (PRD §13). Pure, so the browser can use it. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
