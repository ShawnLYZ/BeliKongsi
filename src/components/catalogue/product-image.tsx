import { Coffee, Droplet, Egg, Milk, Package, Wheat, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  dairy: Milk,
  oil: Droplet,
  flour: Wheat,
  beverages: Coffee,
  eggs: Egg,
  packaging: Package,
};

/**
 * A product picture. AI-generated pictures say so in a caption (PRD §17); a product without one
 * shows an icon for its category instead.
 */
export function ProductImage({
  product,
  className,
}: {
  product: {
    name: string;
    category: string;
    imageUrl: string | null;
    imageAiGenerated: boolean;
  };
  className?: string;
}) {
  if (product.imageUrl) {
    return (
      <figure className={cn('bg-muted overflow-hidden rounded-xl', className)}>
        {/* Plain img: pictures are small pre-compressed WebP files from our own storage. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.imageUrl}
          alt={product.name}
          width={512}
          height={512}
          loading="lazy"
          className="aspect-square w-full object-cover"
        />
        {product.imageAiGenerated ? (
          <figcaption className="text-muted-foreground px-2 py-1 text-sm">
            AI-generated image
          </figcaption>
        ) : null}
      </figure>
    );
  }
  const Icon = CATEGORY_ICONS[product.category] ?? Package;
  return (
    <div
      role="img"
      aria-label={product.name}
      className={cn(
        'bg-muted text-muted-foreground flex aspect-square items-center justify-center rounded-xl',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-1/3" />
    </div>
  );
}
