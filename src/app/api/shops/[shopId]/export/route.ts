import { exportShopData } from '@/server/modules/directory/export';
import { route } from '@/server/platform/http';

export const dynamic = 'force-dynamic';

export const GET = route({ auth: ['owner'] }, async ({ deps, caller, params }) => {
  const { filename, bytes } = await exportShopData(deps, caller, params.shopId!);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
});
