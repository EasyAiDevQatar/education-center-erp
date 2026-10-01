-- A guardian may have several named homes. Students receive a snapshot of the
-- selected home when they are created, so no Student foreign key is required.
CREATE TABLE "GuardianHome" (
    "id" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT,
    "homeCode" TEXT,
    "homeLat" DOUBLE PRECISION,
    "homeLng" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianHome_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GuardianHome_guardianId_sortOrder_idx"
ON "GuardianHome"("guardianId", "sortOrder");

ALTER TABLE "GuardianHome"
ADD CONSTRAINT "GuardianHome_guardianId_fkey"
FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
