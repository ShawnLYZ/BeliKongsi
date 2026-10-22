import { seedId } from '../../../prisma/seed/ids';
import type { Session } from '@/server/platform/session';

export function session(
  key: string,
  role: Session['membership']['role'],
  org: { shopId?: string; supplierId?: string; operatorId?: string },
  orgType: Session['membership']['orgType'],
): Session {
  return {
    userId: seedId('user', key),
    displayName: key,
    membership: {
      id: seedId('membership', key),
      role,
      orgType,
      orgId: org.shopId ?? org.supplierId ?? org.operatorId ?? '',
      orgName: 'x',
      ...org,
    },
  };
}
