// Separate from push: email failures must not suppress the existing 17:00 push.
const crypto = require('node:crypto');
const { serviceRpc, seoulToday } = require('../api/_lib');
const { translate } = require('../api/translate');
const { renderEmail, translateEmail, monday } = require('./weekly-email');
const { gmailConfig, accessToken, rawMessage, sendGmail } = require('./gmail');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
    const expected = process.env.CRON_SECRET;
    const got = Buffer.from(req.headers.authorization || '');
    const want = Buffer.from('Bearer ' + expected);
    if (!expected || got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: 'unauthorized' });
    if (process.env.WEEKLY_EMAIL_ENABLED !== 'true') return res.status(200).json({ skipped: 'disabled' });
    const t = seoulToday();
    if (t.dow !== 5 || t.date.getUTCHours() !== 17) return res.status(200).json({ skipped: 'outside Friday 17:00 KST' });
    const week = monday(t.iso), config = gmailConfig();
    const recipients = await serviceRpc('weekly_email_recipients', {});
    if (!Array.isArray(recipients) || !recipients.length) throw new Error('No eligible email recipients configured.');
    // The DB validates current senior roles and supplies verified account emails, never request body addresses.
    const token = await accessToken(config);
    const counts = { sent: 0, skipped: 0, failed: 0, uncertain: 0 };
    for (const recipient of recipients) {
      if (!UUID.test(recipient.auth_user_id) || !['en', 'ko'].includes(recipient.lang)) throw new Error('Invalid recipient configuration.');
      const claim = await serviceRpc('weekly_email_claim', { p_week: week, p_auth_user: recipient.auth_user_id });
      if (!claim) { counts.skipped++; continue; }
      let sending = false;
      try {
        const data = await serviceRpc('weekly_email_snapshot', { p_week: week, p_auth_user: recipient.auth_user_id });
        if (!data || data.week !== week || data.auth_user_id !== recipient.auth_user_id) throw new Error('Invalid weekly snapshot.');
        const tx = recipient.lang === 'en' ? await translateEmail(data, translate, process.env.OPENAI_API_KEY || '') : {};
        const email = renderEmail(data, recipient.lang, tx);
        const messageId = `tlc-weekly-${week}-${recipient.auth_user_id}@${config.from.split('@')[1]}`;
        const raw = rawMessage(config.from, recipient.email, email, messageId);
        // Persist sending BEFORE the external request. Never automatically resend a sending/uncertain row.
        await serviceRpc('weekly_email_mark', { p_id: claim, p_state: 'sending', p_message_id: messageId });
        sending = true;
        const gmailId = await sendGmail(token, raw);
        await serviceRpc('weekly_email_mark', { p_id: claim, p_state: 'sent', p_message_id: gmailId });
        counts.sent++;
      } catch (_) {
        const state = sending ? 'uncertain' : 'failed';
        await serviceRpc('weekly_email_mark', { p_id: claim, p_state: state, p_message_id: null });
        counts[state]++;
      }
    }
    return res.status(counts.failed || counts.uncertain ? 502 : 200).json({ week, ...counts });
  } catch (_) {
    // Do not echo DB/provider errors, recipient addresses or care records.
    return res.status(503).json({ error: 'Weekly email is not ready. Check server configuration and delivery status.' });
  }
};
