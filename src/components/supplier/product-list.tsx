import type { SupplierProductView } from '@/lib/views/supplier';
import { EmptyState } from '@/components/common/empty-state';
import { Money } from '@/components/common/money';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "20:00" -> "8:00 pm" */
function clock12(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The supplier's products and price tiers, read-only. */
export function ProductList({ products }: { products: SupplierProductView[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Products and tiers</h1>
        <p className="mt-1 text-base">
          Read-only. To change a price or tier, contact BeliKongsi Ops.
        </p>
      </div>
      {products.length === 0 ? (
        <EmptyState
          title="No products yet"
          explanation="Your products appear here with their pack, buy-alone price and Kongsi price tiers."
          example="Sweetened condensed milk 390 g: 20+ RM 158.00, 50+ RM 152.00, 100+ RM 146.00."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {products.map((p) => (
            <li key={p.productId} className="bg-card flex flex-col gap-3 rounded-2xl border p-4">
              <div>
                <h2 className="text-lg font-semibold">{p.name}</h2>
                <p className="text-muted-foreground text-base">
                  {p.packDescription} · {p.cadence} · closes {WEEKDAYS[p.cutoffWeekday - 1] ?? ''}{' '}
                  {clock12(p.cutoffTime)}
                  {p.active ? '' : ' · not active'}
                </p>
              </div>
              <table className="w-full border-collapse text-left text-base">
                <caption className="sr-only">Price tiers for {p.name}</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="py-2 font-semibold">
                      Price
                    </th>
                    <th scope="col" className="py-2 text-right font-semibold">
                      Minimum order
                    </th>
                    <th scope="col" className="py-2 text-right font-semibold">
                      Per {p.unitName}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2">Buy alone</td>
                    <td className="py-2 text-right tabular-nums">1</td>
                    <td className="py-2 text-right">
                      <Money sen={p.buyAlonePriceSen} />
                    </td>
                  </tr>
                  {p.tiers.map((t) => (
                    <tr key={t.position} className="border-b last:border-b-0">
                      <td className="py-2">Tier {t.position}</td>
                      <td className="py-2 text-right tabular-nums">{t.minQuantity}+</td>
                      <td className="py-2 text-right">
                        <Money sen={t.unitPriceSen} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
