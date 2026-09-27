const crypto = require('crypto');
const { Resend } = require('resend');
const supabase = require('../config/supabase');

const siteUrl = (process.env.NEWS_SITE_URL || 'https://www.sanctuarynews.org').replace(/\/$/, '');
const from = process.env.NEWSLETTER_FROM || 'Sanctuary News <briefing@sanctuarynews.org>';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const createToken = () => crypto.randomBytes(32).toString('base64url');
const tokenSecret = () => process.env.NEWSLETTER_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
const createManageToken = (subscriberId) => {
  if (!tokenSecret()) throw new Error('NEWSLETTER_TOKEN_SECRET is not configured');
  const signature = crypto.createHmac('sha256', tokenSecret()).update(String(subscriberId)).digest('base64url');
  return `${subscriberId}.${signature}`;
};
const parseManageToken = (token) => {
  const [subscriberId, signature] = String(token || '').split('.');
  if (!subscriberId || !signature || !tokenSecret()) return null;
  const expected = crypto.createHmac('sha256', tokenSecret()).update(subscriberId).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected) ? subscriberId : null;
};
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

async function sendEmail(payload, idempotencyKey) {
  if (!resend) throw new Error('RESEND_API_KEY is not configured');
  const { data, error } = await resend.emails.send({ from, ...payload }, { idempotencyKey });
  if (error) throw new Error(error.message || 'Resend rejected the email');
  return data;
}

async function sendEmailWithRetry(payload, idempotencyKey, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await sendEmail(payload, idempotencyKey); }
    catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function sendConfirmation(email, token) {
  const confirmUrl = `${siteUrl}/newsletter/confirm?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to: email,
    subject: 'Confirm your Sanctuary News Daily Briefing',
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#181818"><p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#a00000;font-weight:700">Sanctuary News</p><h1 style="font-family:Georgia,serif">Confirm your Daily Briefing</h1><p>The stories shaping today—sourced carefully and considered through Scripture. Free every morning.</p><p style="margin:32px 0"><a href="${confirmUrl}" style="background:#111;color:#fff;padding:14px 20px;text-decoration:none;font-weight:700">Confirm subscription</a></p><p style="font-size:13px;color:#666">If you did not request this, you can ignore this email.</p></div>`,
  }, `newsletter-confirm-${hashToken(email)}-${hashToken(token).slice(0, 16)}`);
}

async function sendWelcome(email, unsubscribeToken) {
  const preferencesUrl = `${siteUrl}/newsletter/preferences?token=${encodeURIComponent(unsubscribeToken)}`;
  return sendEmail({
    to: email,
    subject: 'Welcome to the Sanctuary News Daily Briefing',
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#181818"><p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#a00000;font-weight:700">Sanctuary News</p><h1 style="font-family:Georgia,serif">A calmer way to follow the news</h1><p>Each morning, we’ll send three essential stories, what remains uncertain, a pastoral reflection, and one faithful response.</p><p><a href="${preferencesUrl}">Choose the topics you care about</a></p></div>`,
  }, `newsletter-welcome-${hashToken(email)}`);
}

function briefingHtml({ date, synopsis, articles, unsubscribeToken }) {
  const articleHtml = articles.map((article, index) => {
    const summary = article.ai_outlook?.synopsis || article.ai_outlook?.newsSummary || article.news_impact_summary || '';
    const uncertainty = article.ai_outlook?.sourceAnalysis || article.ai_outlook?.sourceAndFramingAnalysis || 'Review the linked reporting for source context and developing details.';
    return `<section style="border-top:1px solid #ddd;padding:24px 0"><p style="font-size:12px;color:#a00000;font-weight:700">ESSENTIAL STORY ${index + 1}</p><h2 style="font-family:Georgia,serif"><a style="color:#111" href="${siteUrl}/article/${encodeURIComponent(article.slug || article.id)}?utm_source=daily_briefing&utm_medium=email&utm_campaign=${date}">${escapeHtml(article.article_title)}</a></h2><p><strong>What happened:</strong> ${escapeHtml(summary)}</p><p><strong>What remains uncertain:</strong> ${escapeHtml(uncertainty)}</p></section>`;
  }).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:32px;color:#181818"><p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#a00000;font-weight:700">Sanctuary News · Daily Briefing</p><h1 style="font-family:Georgia,serif">The stories shaping today</h1><p>${escapeHtml(synopsis?.synopsis || 'A sourced, Scripture-conscious review of today’s most consequential stories.')}</p>${articleHtml}<section style="background:#f4f0e6;padding:20px;margin-top:24px"><h2 style="font-family:Georgia,serif">A thought for today</h2><p>${escapeHtml(synopsis?.scripture || synopsis?.prayer || 'Seek truth, protect human dignity, and practice peace in the way you receive and share today’s news.')}</p></section><p style="font-size:12px;color:#666;margin-top:32px">You received this because you confirmed a Sanctuary News subscription. <a href="${siteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}">Unsubscribe</a> or <a href="${siteUrl}/newsletter/preferences?token=${encodeURIComponent(unsubscribeToken)}">manage preferences</a>.</p></div>`;
}

module.exports = { briefingHtml, createManageToken, createToken, escapeHtml, hashToken, parseManageToken, sendConfirmation, sendEmail, sendEmailWithRetry, sendWelcome, siteUrl };
