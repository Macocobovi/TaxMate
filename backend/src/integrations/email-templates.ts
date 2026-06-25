// Branded, email-client-safe templates (table layout + inline styles).
// Keep these in sync with the frontend brand tokens in
// frontend/src/app/globals.css (primary #04763b, secondary #07552f, accent #e8f5ec).

const BRAND = {
  primary: "#04763b",
  secondary: "#07552f",
  accent: "#e8f5ec",
  background: "#f7f8f4",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0"
};

const OTP_TTL_MINUTES = 10;

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function otpEmail(otp: string): EmailContent {
  const subject = `${otp} is your Taxmate verification code`;

  const text = [
    "Taxmate",
    "",
    "Verify your email",
    `Your verification code is: ${otp}`,
    `This code expires in ${OTP_TTL_MINUTES} minutes. Enter it on Taxmate to continue.`,
    "",
    "If you did not request this code, you can safely ignore this email.",
    "",
    "Taxmate — Modern tax compliance for Nigerians."
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.background};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your Taxmate verification code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.background};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <tr>
              <td style="background-color:${BRAND.primary};padding:24px 32px;">
                <span style="display:inline-block;width:32px;height:32px;line-height:32px;text-align:center;background-color:#ffffff;color:${BRAND.primary};border-radius:50%;font-weight:800;font-size:16px;vertical-align:middle;">T</span>
                <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.3px;vertical-align:middle;padding-left:10px;">Taxmate</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;font-size:20px;font-weight:800;color:${BRAND.text};">Verify your email</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${BRAND.muted};">Use the verification code below to continue setting up your Taxmate account.</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="background-color:${BRAND.accent};border:1px solid ${BRAND.primary}1a;border-radius:12px;padding:20px;">
                      <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:${BRAND.secondary};font-family:'Courier New',Courier,monospace;">${otp}</div>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:${BRAND.muted};">This code expires in <strong style="color:${BRAND.text};">${OTP_TTL_MINUTES} minutes</strong>. If you did not request it, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${BRAND.border};">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">Taxmate — Modern tax compliance for Nigerian individuals, businesses, and administrators.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
