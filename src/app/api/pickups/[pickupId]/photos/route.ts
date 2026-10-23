import { z } from 'zod';
import { requestPhotoUpload } from '@/server/modules/checks/photos';
import { json, route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

// The type and size are checked by the module, so a PDF or a 6 MB photo gets 422, not 400.
const body = z.object({ contentType: z.string().max(100), sizeBytes: z.number().int().min(1) });

export const POST = route(
  { auth: ['owner', 'staff'], body },
  async ({ deps, caller, params, body: input }) =>
    json(await requestPhotoUpload(deps, caller, params.pickupId!, input)),
);
