const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { aiLimiter } = require('../middleware/limiters');
const authenticateUser = require('../middleware/auth');
const { logEvent, callOpenAIAndProcessResult } = require('../utils/helpers');
const { getAdviceGuidancePrompt } = require('../prompts');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { escapeHtml, sendEmailWithRetry } = require('../services/newsletter');
const openai = require('../config/openai');

const FREE_TIER_ADVICE_LIMIT = 1; // 1 advice per month for free users
const tryGuidanceLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many guidance requests. Please try again later.' },
});

const appStoreUrl = 'https://apps.apple.com/us/app/sanctuary-daily-faith-focus/id6757966099';
const googlePlayUrl = 'https://play.google.com/store/apps/details?id=us.sanctuaryapp.app';
const urgentSafetyPattern = /\b(kill myself|end my life|suicid(?:e|al)|self[- ]?harm|hurt myself|overdos(?:e|ed|ing)|in immediate danger|being abused|domestic violence|sexual assault|can'?t breathe|chest pain|medical emergency)\b/i;

router.post('/try-guidance', tryGuidanceLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const situation = String(req.body?.situation || '').trim();
    const marketingConsent = req.body?.marketingConsent === true;
    const honeypot = String(req.body?.website || '').trim();

    if (honeypot) return res.status(202).json({ ok: true });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (situation.length < 15 || situation.length > 2000) return res.status(400).json({ error: 'Share between 15 and 2,000 characters.' });

    try {
        const moderation = await openai.moderations.create({ model: 'omni-moderation-latest', input: situation });
        const categories = moderation.results?.[0]?.categories || {};
        const needsImmediateHelp = urgentSafetyPattern.test(situation)
            || categories['self-harm']
            || categories['self-harm/intent']
            || categories['self-harm/instructions'];
        if (needsImmediateHelp) {
            return res.status(422).json({
                code: 'IMMEDIATE_SUPPORT_NEEDED',
                error: 'You deserve immediate, human support. If you may hurt yourself or someone else, call emergency services now. In the U.S. or Canada, call or text 988. If abuse or danger is involved, move to a safer place if you can and contact local emergency or crisis services. Sanctuary cannot safely address an emergency by email.',
            });
        }

        const systemPrompt = await getAdviceGuidancePrompt();
        const guidance = await callOpenAIAndProcessResult(
            systemPrompt,
            `Situation: ${situation}\nCurrent private spiritual growth journey: No areas selected.`,
            'gpt-4.1-2025-04-14',
            2500,
            'json_object',
        );
        const steps = Array.isArray(guidance.advice_points) ? guidance.advice_points.slice(0, 3) : [];
        const reading = guidance.scripture_reading || {};
        if (steps.length !== 3 || !guidance.acknowledgment || !reading.reference || !reading.reason || !guidance.prayer) {
            throw new Error('Guidance response did not pass the delivery quality gate');
        }

        if (marketingConsent) {
            const { error: leadError } = await supabase.from('trial_guidance_leads').upsert({
                email,
                marketing_consented_at: new Date().toISOString(),
                source: 'marketing_try_guidance',
                status: 'subscribed',
                updated_at: new Date().toISOString(),
            }, { onConflict: 'email' });
            if (leadError) console.error('Could not save try-guidance marketing consent:', leadError);
        }

        const stepHtml = steps.map((step, index) => `<li style="margin-bottom:14px;padding-left:6px">${escapeHtml(step)}</li>`).join('');
        const emailHtml = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#17231d;line-height:1.6"><p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b5a35;font-weight:700">Sanctuary Guidance</p><h1 style="font-family:Georgia,serif;font-size:32px">Personalized biblical guidance for what you’re facing</h1>${guidance.acknowledgment ? `<p style="font-size:17px;color:#405449">${escapeHtml(guidance.acknowledgment)}</p>` : ''}<h2 style="font-family:Georgia,serif">Three practical next steps</h2><ol style="padding-left:24px">${stepHtml}</ol>${reading.reference ? `<div style="background:#f4f0e6;padding:20px;margin:24px 0"><strong>Scripture to read in context</strong><p style="margin-bottom:0"><b>${escapeHtml(reading.reference)}</b>${reading.reason ? ` — ${escapeHtml(reading.reason)}` : ''}</p></div>` : ''}${guidance.prayer ? `<h2 style="font-family:Georgia,serif">A brief prayer</h2><p>${escapeHtml(guidance.prayer)}</p>` : ''}<div style="border-top:1px solid #e2d8c6;margin-top:32px;padding-top:28px;text-align:center"><h2 style="font-family:Georgia,serif;margin:0 0 8px">Continue with Sanctuary</h2><p style="margin:0 auto 22px;max-width:500px;color:#405449">Save your guidance, return to it, explore personalized devotionals, and find practical biblical direction whenever life changes.</p><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;border-collapse:separate;border-spacing:8px 0"><tr><td align="center" bgcolor="#c6a55c" style="border-radius:8px"><a href="${appStoreUrl}?utm_source=try_guidance_email&utm_medium=email&utm_campaign=personalized_guidance" style="display:block;border:1px solid #b69346;border-radius:8px;background:#c6a55c;color:#17231d;padding:13px 18px;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;white-space:nowrap">Continue on iPhone</a></td><td align="center" bgcolor="#2e7a55" style="border-radius:8px"><a href="${googlePlayUrl}&utm_source=try_guidance_email&utm_medium=email&utm_campaign=personalized_guidance" style="display:block;border:1px solid #246545;border-radius:8px;background:#2e7a55;color:#ffffff;padding:13px 18px;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;white-space:nowrap">Continue on Android</a></td></tr></table><p style="margin:14px 0 0;font-size:12px;color:#718078">Available for iPhone and Android</p></div><p style="font-size:12px;color:#6b7280;margin-top:28px">Sanctuary offers Scripture-centered reflection and practical guidance. It does not replace pastoral care, professional counseling, medical care, legal advice, or emergency support.${marketingConsent ? ' You opted in to occasional Sanctuary product emails; every marketing email will include an unsubscribe option.' : ' This one-time email does not subscribe you to marketing.'}</p></div>`;
        const requestHash = crypto.createHash('sha256').update(`${email}:${situation}`).digest('hex').slice(0, 24);
        await sendEmailWithRetry({
            from: process.env.GUIDANCE_FROM_EMAIL || 'Sanctuary Guidance <guidance@sanctuaryapp.us>',
            to: email,
            subject: 'Your Sanctuary scriptural guidance',
            html: emailHtml,
        }, `try-guidance-${requestHash}`);

        res.json({ ok: true });
    } catch (error) {
        console.error('Try guidance failed:', error);
        res.status(502).json({ error: 'We could not prepare your guidance right now. Please try again.' });
    }
});

// Updated Endpoint: Generate Advice/Guidance with Freemium Checks
router.post('/generate-advice', authenticateUser, aiLimiter, async (req, res) => {
    try {
        const startTime = Date.now();
        const { userId, situation } = req.body;
        if (userId !== req.user.id) return res.status(403).json({ error: 'You can only generate guidance for your own account.' });

        // --- 1. FREEMIUM CHECK START ---
        
        // Fetch user profile to check tier and usage
        const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('subscription_tier, advice_usage_count, advice_reset_date, user_preferences')
            .eq('user_id', userId)
            .single();

        if (profileError) {
            console.error('Error fetching profile for quota check:', profileError);
            return res.status(500).json({ error: 'Failed to verify subscription status.' });
        }

        const isFree = profile.subscription_tier === 'free';
        
        // Logic to Reset Quota (Monthly)
        const now = new Date();
        const lastReset = new Date(profile.advice_reset_date || 0); // Default to epoch if null
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

        // If last reset was more than a month ago, reset the count
        if (lastReset < oneMonthAgo) {
            await supabase
                .from('user_profiles')
                .update({ 
                    advice_usage_count: 0, 
                    advice_reset_date: now.toISOString() 
                })
                .eq('user_id', userId);
            
            // Update local variable so we don't block them immediately
            profile.advice_usage_count = 0;
        }

        // BLOCK if limit reached
        if (isFree && profile.advice_usage_count >= FREE_TIER_ADVICE_LIMIT) {
            return res.status(403).json({ 
                error: 'Free limit reached', 
                code: 'UPGRADE_REQUIRED',
                message: 'You have used your free advice for this month. Upgrade to Pro for unlimited guidance.' 
            });
        }
        // --- FREEMIUM CHECK END ---


        // 2. Create placeholder (Existing Code)
        const { data: newAdvice, error: insertError } = await supabase
            .from('advice_guidance')
            .insert({
                user_id: userId,
                situation: situation,
                advice_points: 'Generating advice...', 
                status: 'pending', 
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('advice_id')
            .single();

        if (insertError) {
            console.error('Error creating placeholder advice:', insertError);
            return res.status(500).json({ error: 'Failed to initiate advice generation.' });
        }

        res.status(202).json({
            message: 'Advice generation initiated.',
            adviceId: newAdvice.advice_id,
            status: 'pending'
        });

        // 3. Start AI generation (Existing Code)
        const systemPrompt = await getAdviceGuidancePrompt();
        const { data: growthProfile } = await supabase
            .from('personal_growth_profiles')
            .select('focus_areas, improvement_areas')
            .eq('user_id', userId)
            .maybeSingle();
        const currentGrowthAreas = growthProfile?.improvement_areas
            || profile.user_preferences?.improvementAreas
            || [];
        const userPrompt = `Situation: ${situation}\nCurrent private spiritual growth journey: ${currentGrowthAreas.length ? currentGrowthAreas.join(', ') : 'No areas selected.'}`;
        try {
            const generatedAdvice = await callOpenAIAndProcessResult(
                systemPrompt,
                userPrompt,
                'gpt-4.1-2025-04-14',
                4000, 
                "json_object"
            );

            const guidanceContent = {
                steps: Array.isArray(generatedAdvice.advice_points)
                    ? generatedAdvice.advice_points.slice(0, 3)
                    : [],
                scripture_reading: generatedAdvice.scripture_reading || null,
                prayer: generatedAdvice.prayer || '',
                acknowledgment: generatedAdvice.acknowledgment || '',
                follow_up_question: generatedAdvice.follow_up_question || null,
                suggested_growth_area: generatedAdvice.suggested_growth_area || null,
            };

            // Update advice content
            const { error: updateError } = await supabase
                .from('advice_guidance')
                .update({
                    situation: generatedAdvice.situation_summary || situation, 
                    advice_points: JSON.stringify(guidanceContent),
                    status: 'completed',
                    updated_at: new Date().toISOString(),
                })
                .eq('advice_id', newAdvice.advice_id);
            
            const duration = Date.now() - startTime;

            if (updateError) {
                logEvent('error', 'backend', userId, 'generate_advice', 'Failed to update advice record', { error: updateError.message }, duration);
                console.error(`Error updating advice record ${newAdvice.advice_id}:`, updateError);
                await supabase.from('advice_guidance').update({ status: 'failed' }).eq('advice_id', newAdvice.advice_id);
            } else {
                // --- 4. INCREMENT USAGE (NEW) ---
                if (isFree) {
                    // We increment the count we fetched earlier
                    const newCount = (profile.advice_usage_count || 0) + 1;
                    await supabase
                        .from('user_profiles')
                        .update({ advice_usage_count: newCount })
                        .eq('user_id', userId);
                    console.log(`Incremented advice usage for user ${userId} to ${newCount}`);
                }
                // -------------------------------

                logEvent('ai', 'backend', userId, 'generate_advice', 'Successfully generated advice', {tokens: generatedAdvice.tokens}, duration);
                console.log(`Advice record ${newAdvice.advice_id} successfully generated and updated.`);
            }
        } catch (aiError) {
            // ... (Existing Error Handling) ...
            logEvent('error', 'backend', userId, 'generate_advice', 'AI generation failed', { error: aiError.message }, Date.now() - startTime);
            console.error(`AI generation failed for advice ${newAdvice.advice_id}:`, aiError);
            await supabase.from('advice_guidance').update({ status: 'failed' }).eq('advice_id', newAdvice.advice_id);
        }

    } catch (error) {
        // ... (Existing Error Handling) ...
        logEvent('error', 'backend', null, 'generate_advice', 'Unhandled error', { error: error.message }, 0);
        console.error('Unhandled error in /generate-advice:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
});

// New Fetching Endpoint: Get Advice/Guidance for a user
router.get('/advice/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
        .from('advice_guidance')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching advice:', error);
        return res.status(500).json({ error: 'Failed to fetch advice.' });
    }
    res.json(data);
});

//New Fetching Endpoint: Get Advice/Guidance by adviceId
router.get('/advice/:userId/:adviceId', authenticateUser, async (req, res) => {

    const { adviceId, userId } = req.params;
    const { data, error } = await supabase
        .from('advice_guidance')
        .select('*')
        .eq('user_id', userId)
        .eq('advice_id', adviceId)
        .single();
    if (error) {
        console.error('Error fetching advice by ID:', error);
        return res.status(500).json({ error: 'Failed to fetch advice by ID.' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Advice not found.' });
    }
    res.json(data);
});

// DELETE ADVICE (AND CLEANUP FAVORITES)
router.delete('/advice/:adviceId', authenticateUser, async (req, res) => {
    const { adviceId } = req.params;
    const userId = req.user.id; // From auth middleware

    try {
        // 1. Remove from Favorites/Saved Items first
        // (Replace 'user_favorites' with your actual table name, e.g., 'saved_items')
        const { error: favError } = await supabase
            .from('user_favorites') 
            .delete()
            .eq('item_id', adviceId); // Delete ALL favorites for this item, regardless of user
        
        if (favError) {
            console.warn(`[Cleanup] Failed to remove favorites for advice ${adviceId}:`, favError.message);
            // We continue anyway because we want to delete the advice
        }

        // 2. Delete the Advice Item
        const { error } = await supabase
            .from('advice')
            .delete()
            .eq('id', adviceId)
            .eq('user_id', userId); // Security: Ensure they own the advice

        if (error) throw error;

        res.status(200).json({ success: true });

    } catch (error) {
        console.error("Delete Error:", error.message);
        res.status(500).json({ error: "Failed to delete advice." });
    }
});

module.exports = router;
