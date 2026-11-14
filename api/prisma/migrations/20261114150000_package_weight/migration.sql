-- A parcel's actual weight, typed by the customer.
--
-- The four sizes carry weight HINTS in the app -- "≤ 5 kg", "≤ 15 kg" -- but
-- the weight itself was never recorded, so a rider accepting a job knew only
-- which of four buckets it fell in. The difference between a 6 kg parcel and a
-- 14 kg one decides whether a bike can take it at all, and both are "Large".
--
-- Additive and nullable: every existing parcel reads as "not stated", which is
-- exactly what it is. Nothing is backfilled and no default is invented, because
-- a made-up weight on a historical order would be worse than no weight.
--
-- DOUBLE PRECISION rather than an integer of grams: people say "2.5 kg", and
-- the value is advisory -- it informs the rider and justifies a fee the
-- customer may adjust. It is deliberately NOT a pricing input. The size and
-- distance table is already only a suggestion that riders counter, and making
-- weight multiply a price would turn a helpful field into a bill the customer
-- did not expect.

ALTER TABLE "package_details" ADD COLUMN "weightKg" DOUBLE PRECISION;
