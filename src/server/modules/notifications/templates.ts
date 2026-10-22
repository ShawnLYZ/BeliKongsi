import type { Role } from '@/generated/prisma/client';

export type NotificationMessage = { title: string; body: string; whatsappText: string };

// A builder takes the event data and returns a function from role to message,
// so a message can differ by audience (for example staff text carries no amounts).
export type TemplateBuilder<D = Record<string, unknown>> = (
  data: D,
) => (role: Role) => NotificationMessage;

/** Keeps each entry's own data type so a caller can use it type-safely. */
export function defineTemplates<T extends { [type: string]: TemplateBuilder<never> }>(
  templates: T,
): T {
  return templates;
}

// Later milestones add their PRD section 13 entries, keyed by notification type, with
// `defineTemplates({ type: (data: Data) => (role) => ({ ... }) })`.
export const TEMPLATES = defineTemplates({});
