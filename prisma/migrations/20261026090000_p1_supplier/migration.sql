-- M13 P1: supplier self-service. The price-list reader is logged as its own AI run kind.

-- AlterEnum
ALTER TYPE "AiRunKind" ADD VALUE 'price_list';
