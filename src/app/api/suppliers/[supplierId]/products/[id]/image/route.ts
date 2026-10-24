import { z } from 'zod';
import { requestProductImageUpload } from '@/server/modules/catalogue/supplier-edit';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

const uploadRequest = z.strictObject({
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export const POST = route(
  { auth: ['supplier'], body: uploadRequest },
  async ({ deps, caller, params, body }) =>
    json(await requestProductImageUpload(deps, caller, params.supplierId!, params.id!, body)),
);
