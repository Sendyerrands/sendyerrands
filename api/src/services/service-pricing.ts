/**
 * What Sendy charges on a service job.
 *
 * Three charges, and they are defined here once because they appear in at
 * least four places that must agree to the kobo: the quote the provider sends,
 * the total the customer is asked to pay, the earning the provider is owed,
 * and the receipt. A second copy of "10%" anywhere is a rounding bug waiting
 * to be discovered by someone who was over- or under-paid.
 *
 * The two percentages are taken on the provider's quote. The flat fee is not,
 * which is the point of it: a ₦2,000 job and a ₦200,000 job cost the same to
 * put through the system.
 *
 * These sit ON TOP of the quote. The provider is paid the number they named;
 * the customer pays that plus the charges. Deducting them from the quote
 * instead would mean a provider quoting ₦20,000 receives ₦17,000, which is a
 * different commercial deal and one they have not agreed to.
 */

/** Flat, per job. ₦500. */
export const SERVICE_FEE_KOBO = 50_000;
/** Sendy's cut of the work itself. */
export const SERVICE_CHARGE_RATE = 0.1;
/**
 * Transport. A percentage, not the old flat bike/car arrival fee — that is no
 * longer charged, though `arrivalMode` is still asked because the customer
 * needs to know whether someone is arriving on a bike with a bag or in a car
 * with equipment.
 */
export const TRANSPORT_RATE = 0.05;

export type ServiceCharges = {
  /** The provider's quote — what the work costs. */
  quoteKobo: number;
  serviceFeeKobo: number;
  serviceChargeKobo: number;
  transportKobo: number;
  /** The three charges totalled — Sendy's revenue on this job. */
  feesKobo: number;
  /** What the customer pays. */
  totalKobo: number;
  /** What the provider is owed. Equal to the quote, by design. */
  providerNetKobo: number;
};

/**
 * Rounded to whole kobo at each line rather than on the total.
 *
 * Deliberate: the customer is shown three numbers and a total, and a total
 * that is not the sum of the lines above it reads as a mistake even when it is
 * a rounding artefact. Rounding per line costs at most a kobo of precision and
 * buys a receipt that adds up.
 */
export function computeServiceCharges(quoteKobo: number): ServiceCharges {
  const quote = Math.max(0, Math.round(quoteKobo));

  // No quote means no job yet, so nothing is charged — not even the flat fee.
  // A booking sitting at QUOTE_REQUESTED must show ₦0, not ₦500.
  if (quote === 0) {
    return {
      quoteKobo: 0,
      serviceFeeKobo: 0,
      serviceChargeKobo: 0,
      transportKobo: 0,
      feesKobo: 0,
      totalKobo: 0,
      providerNetKobo: 0,
    };
  }

  const serviceFeeKobo = SERVICE_FEE_KOBO;
  const serviceChargeKobo = Math.round(quote * SERVICE_CHARGE_RATE);
  const transportKobo = Math.round(quote * TRANSPORT_RATE);
  const feesKobo = serviceFeeKobo + serviceChargeKobo + transportKobo;

  return {
    quoteKobo: quote,
    serviceFeeKobo,
    serviceChargeKobo,
    transportKobo,
    feesKobo,
    totalKobo: quote + feesKobo,
    providerNetKobo: quote,
  };
}

/**
 * The same breakdown, labelled for a receipt or a quote screen.
 *
 * Returned by the API rather than assembled in the app so the website, the app
 * and the admin dashboard cannot drift into describing the same charge three
 * different ways.
 */
export function describeServiceCharges(c: ServiceCharges) {
  return [
    { label: 'The job', amountKobo: c.quoteKobo },
    { label: 'Service fee', amountKobo: c.serviceFeeKobo },
    { label: 'Service charge (10%)', amountKobo: c.serviceChargeKobo },
    { label: 'Transport (5%)', amountKobo: c.transportKobo },
  ];
}
