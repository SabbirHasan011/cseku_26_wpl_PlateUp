const nodemailer = require('nodemailer');

function createPasswordResetSender() {
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM || !process.env.APP_ORIGIN) return null;
  const origin = new URL(process.env.APP_ORIGIN);
  if (!['http:','https:'].includes(origin.protocol)) throw new Error('APP_ORIGIN must be an HTTP(S) URL.');
  const transport = nodemailer.createTransport({
    host:process.env.SMTP_HOST, port:Number(process.env.SMTP_PORT || 587),
    secure:process.env.SMTP_SECURE === 'true',
    requireTLS:process.env.SMTP_SECURE !== 'true',
    ...(process.env.SMTP_USER ? { auth:{ user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD } } : {}),
    connectionTimeout:10000, greetingTimeout:10000, socketTimeout:15000
  });
  return async ({ email,token }) => {
    const link = new URL('/',origin);
    link.hash = 'reset=' + token;
    await transport.sendMail({ from:process.env.MAIL_FROM,to:email,subject:'Reset your PlateUp password',
      text:'Use this link to set a new PlateUp password:\n\n'+link.href+
        '\n\nThis link expires in 30 minutes and works once. If you did not request it, ignore this email.' });
  };
}
module.exports = { createPasswordResetSender };
