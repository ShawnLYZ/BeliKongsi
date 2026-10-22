import { handleAllocateShortfall } from '@/server/modules/integration/engine-api';
import { route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: 'public' }, ({ request }) => handleAllocateShortfall(request));
