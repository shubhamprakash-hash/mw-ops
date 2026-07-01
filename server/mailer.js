/* ============================================================
   Mailer — used only for the Super-Admin password-reset code.
   nodemailer is an OPTIONAL dependency and is required lazily; if it
   (or SMTP config) is missing, the code is printed to the server log
   instead of emailed, so the flow still works in local / small setups.
   ============================================================ */
const smtpConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

async function sendMail({ to, subject, text }) {
  if (!smtpConfigured()) {
    console.log(`\n[mw-ops] (email not configured) message for ${to}:\n  ${subject}\n  ${text}\n`);
    return { logged: true };
  }
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch { console.log(`\n[mw-ops] (nodemailer not installed) message for ${to}:\n  ${text}\n`); return { logged: true }; }
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@monkeywrench.in';
  await t.sendMail({ from, to, subject, text });
  return { sent: true };
}

module.exports = { sendMail, smtpConfigured };
