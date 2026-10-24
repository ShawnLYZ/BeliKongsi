-- M14 P1 (story 26): an invoice photo that builds the usual list is logged as its own AI run kind.

-- AlterEnum
ALTER TYPE "AiRunKind" ADD VALUE 'usual_list_photo';
