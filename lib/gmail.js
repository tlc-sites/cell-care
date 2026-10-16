const crypto = require('node:crypto');
function address(value) {
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value || '')) throw new Error('Invalid email configuration.');
  return value;
}
function gmailConfig() {
  const config = { from: address(process.env.WEEKLY_EMAIL_FROM), client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET, refresh_token: process.env.GMAIL_REFRESH_TOKEN };
  if (!config.client_id || !config.client_secret || !config.refresh_token) throw new Error('Gmail is not configured.');
  return config;
}
async function accessToken(config) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.client_id,
      client_secret: config.client_secret, refresh_token: config.refresh_token }).toString() });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('Gmail authorization failed.');
  return j.access_token;
}
const b64 = text => Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
function rawMessage(from, to, email, id) {
  const boundary = 'tlc_' + crypto.randomBytes(16).toString('hex');
  if (!/^[a-zA-Z0-9@._-]+$/.test(id)) throw new Error('Invalid message ID.');
  return [
    'From: ' + address(from), 'To: ' + address(to),
    'Subject: =?UTF-8?B?' + Buffer.from(email.subject).toString('base64') + '?=',
    'Date: ' + new Date().toUTCString(), 'Message-ID: <' + id + '>', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"', '',
    '--' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(email.text),
    '--' + boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(email.html),
    '--' + boundary + '--', ''
  ].join('\r\n');
}
async function sendGmail(token, raw) {
  // No automatic retries: a timeout can mean Gmail accepted the message already.
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }) });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error('Gmail delivery was not confirmed.');
  return j.id;
}
module.exports = { address, gmailConfig, accessToken, rawMessage, sendGmail };
