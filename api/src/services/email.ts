import { env, features } from '@/config/env';

/**
 * Transactional email, via Resend (https://resend.com).
 *
 * Plain fetch against the REST API rather than the SDK, matching whatsapp.ts
 * and sms.ts — one dependency fewer, and the failure modes stay visible instead
 * of being wrapped.
 *
 * To go live:
 *   1. Create a Resend account and verify the domain you send from.
 *   2. Put the API key in RESEND_API_KEY.
 *   3. Set EMAIL_FROM to an address on that verified domain, e.g.
 *      "Sendy Errands <no-reply@sendyerrands.com>". Sending from an unverified
 *      domain is accepted by the API and then silently binned by inbox
 *      providers, which looks exactly like the code being broken.
 */

type SendResult = { ok: true; id: string } | { ok: false; reason: string };

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendResult> {
  if (!features.email) {
    return { ok: false, reason: 'RESEND_API_KEY is not configured' };
  }

  try {
    const res = await fetch(`${env.RESEND_BASE_URL}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [params.to],
        // Sending and receiving are two different services on this domain:
        // Resend sends from no-reply@ and has no inbox, Zoho holds the root MX.
        // Reply-To is what bridges them, so a reply reaches a person.
        reply_to: env.EMAIL_REPLY_TO,
        subject: params.subject,
        // Both parts, always. A text/plain alternative is a meaningful signal
        // to spam filters and the only thing some clients will render.
        text: params.text,
        html: params.html,
      }),
    });

    const payload = (await res.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null;

    if (!res.ok) {
      const reason = payload?.message ?? `HTTP ${res.status}`;
      console.error(`[email] send failed: ${reason}`);
      return { ok: false, reason };
    }

    return { ok: true, id: payload?.id ?? 'unknown' };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.error(`[email] unreachable: ${reason}`);
    return { ok: false, reason };
  }
}

/**
 * The password reset code.
 *
 * Says what to do if it was not you, and does not include a link. A six-digit
 * code typed into the app cannot be phished by a lookalike domain in the way a
 * clickable reset URL can, and it keeps the flow identical on every platform.
 */
export function passwordResetEmail(code: string, minutes: number) {
  const subject = `${code} is your Sendy Errands password reset code`;

  const text = [
    `Your Sendy Errands password reset code is ${code}.`,
    ``,
    `It expires in ${minutes} minutes.`,
    ``,
    `If you did not ask to reset your password, you can ignore this email —`,
    `nothing has changed, and your current password still works.`,
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#171717">
  <h1 style="font-size:20px;margin:0 0 24px">Reset your password</h1>
  <p style="font-size:15px;line-height:22px;margin:0 0 24px">
    Enter this code in the Sendy Errands app:
  </p>
  <p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:0 0 24px;color:#E6297A">
    ${code}
  </p>
  <p style="font-size:15px;line-height:22px;margin:0 0 24px">
    It expires in ${minutes} minutes.
  </p>
  <p style="font-size:13px;line-height:20px;color:#6B7280;margin:0">
    If you did not ask to reset your password, you can ignore this email —
    nothing has changed, and your current password still works.
  </p>
</div>`.trim();

  return { subject, text, html };
}

/**
 * "Your shop is approved, here is how to get in."
 *
 * Approval used to send nothing at all. A vendor was created, appeared in the
 * dashboard, and the owner was never told — so the only way in was an operator
 * remembering to ring them. From the applicant's side the application simply
 * went quiet, which is indistinguishable from being ignored.
 *
 * It carries no password. Vendors are created with `passwordHash` null by
 * design and claim the account through the reset flow, which is why this points
 * at "Forgot password" rather than shipping a temporary credential that would
 * sit in an inbox forever. Nor does it carry a reset code: codes live for 15
 * minutes and this email may be opened the next morning, so a code here would
 * be expired more often than not and would read as the flow being broken.
 */
export function vendorApprovedEmail(params: { businessName: string; loginEmail: string }) {
  const { businessName, loginEmail } = params;
  const subject = `${businessName} is approved on Sendy Errands`;

  const text = [
    `Good news — ${businessName} has been approved to sell on Sendy Errands.`,
    ``,
    `Your sign-in email is ${loginEmail}.`,
    ``,
    `You do not have a password yet. To set one:`,
    ``,
    `  1. Open the Sendy Errands app and tap "Sign in".`,
    `  2. Choose "Vendor".`,
    `  3. Tap "Forgot password?" and enter ${loginEmail}.`,
    `  4. We email you a 6-digit code. Enter it and choose your password.`,
    ``,
    `That password also signs you in at https://sendyerrands.com/vendor/login.php`,
    `if you would rather work from a computer.`,
    ``,
    `One thing to expect: your shop is not visible to customers yet. We set up`,
    `your delivery fee and listings with you first, then switch it on.`,
    ``,
    `Any trouble, reply to this email and a person will pick it up.`,
  ].join('\n');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#171717">
  <h1 style="font-size:20px;margin:0 0 20px">${businessName} is approved</h1>
  <p style="font-size:15px;line-height:22px;margin:0 0 20px">
    Welcome to Sendy Errands. Your sign-in email is
    <strong style="color:#E6297A">${loginEmail}</strong>.
  </p>
  <p style="font-size:15px;line-height:22px;margin:0 0 12px">
    You do not have a password yet. To set one:
  </p>
  <ol style="font-size:15px;line-height:24px;margin:0 0 20px;padding-left:22px">
    <li>Open the Sendy Errands app and tap <strong>Sign in</strong>.</li>
    <li>Choose <strong>Vendor</strong>.</li>
    <li>Tap <strong>Forgot password?</strong> and enter your email.</li>
    <li>We email you a 6-digit code — enter it and pick your password.</li>
  </ol>
  <p style="font-size:15px;line-height:22px;margin:0 0 20px">
    That same password works at
    <a href="https://sendyerrands.com/vendor/login.php" style="color:#E6297A">the web portal</a>
    if you would rather use a computer.
  </p>
  <p style="font-size:13px;line-height:20px;color:#6B7280;margin:0 0 8px">
    Your shop is not visible to customers yet — we set up your delivery fee and
    listings with you first, then switch it on.
  </p>
  <p style="font-size:13px;line-height:20px;color:#6B7280;margin:0">
    Any trouble, reply to this email and a person will pick it up.
  </p>
</div>`.trim();

  return { subject, text, html };
}
