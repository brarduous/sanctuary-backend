const openai = require('../config/openai');
const supabase = require('../config/supabase');
const { normalizeContentImageBuffer } = require('./imageAspect');
const { callStructuredResponse } = require('./openaiResponses');

const DEFAULT_BUCKET = 'clergy-content-images';

const cleanText = (value, maxLength = 1200) => {
    if (value === null || value === undefined) return '';
    const text = Array.isArray(value) ? value.join(', ') : String(value);
    return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
};

const slugify = (value) => {
    const slug = cleanText(value, 80)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'content';
};

const buildContentImagePrompt = ({ contentType, title, scripture, illustration, outline, body }) => {
    const typeLabel = contentType === 'bible-study' ? 'Bible study curriculum' : 'sermon';
    const subject = cleanText(illustration, 700) || cleanText(outline, 700) || cleanText(body, 700);

    return [
        `Create a warm, editorial Christian ministry image for a ${typeLabel}.`,
        `Title: ${cleanText(title, 180) || 'Untitled'}.`,
        scripture ? `Scripture or biblical anchor: ${cleanText(scripture, 220)}.` : '',
        `Core visual idea: ${subject}.`,
        'Style: cinematic but natural, reverent, hopeful, modern church publication quality, realistic lighting, rich depth, emotionally grounded.',
        'Composition: exact 16:9 widescreen landscape artwork with a clear focal point. Keep every important subject fully inside the frame with comfortable edge padding; do not crop heads, hands, faces, or symbolic objects.',
        'The image must be purely visual: no words, letters, numbers, captions, title treatments, signs, logos, typography, or watermarks anywhere in the artwork.',
        'Avoid: distorted hands, celebrity likenesses, denominational symbols unless directly implied, sensational or kitsch imagery.'
    ].filter(Boolean).join('\n');
};

async function uploadImageBuffer({ buffer, bucketName, storagePath, contentType }) {
    const { error } = await supabase
        .storage
        .from(bucketName)
        .upload(storagePath, buffer, {
            contentType,
            upsert: true,
        });

    if (error) throw error;

    const { data } = supabase
        .storage
        .from(bucketName)
        .getPublicUrl(storagePath);

    return data.publicUrl;
}

async function generateContentImage({
    contentType,
    contentId,
    userId,
    title,
    scripture,
    illustration,
    outline,
    body,
}) {
    const prompt = buildContentImagePrompt({ contentType, title, scripture, illustration, outline, body });
    const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    const outputFormat = process.env.OPENAI_IMAGE_FORMAT || 'jpeg';
    const bucketName = process.env.SUPABASE_CONTENT_IMAGE_BUCKET || DEFAULT_BUCKET;
    const extension = outputFormat === 'png' ? 'png' : outputFormat === 'webp' ? 'webp' : 'jpg';
    const contentFolder = contentType === 'bible-study' ? 'bible-studies' : 'sermons';
    const storagePath = `${contentFolder}/${userId}/${contentId}-${Date.now()}-${slugify(title)}.${extension}`;

    let imageData;
    for (let visualAttempt = 1; visualAttempt <= 2; visualAttempt += 1) {
        const response = await openai.images.generate({
            model: imageModel,
            prompt: visualAttempt === 1 ? prompt : `${prompt}\nRegeneration requirement: the prior artwork was rejected because it contained lettering or a logo. Return only text-free visual artwork.`,
            size: process.env.OPENAI_IMAGE_SIZE || '1536x1024',
            quality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
            output_format: outputFormat,
            output_compression: outputFormat === 'jpeg' || outputFormat === 'webp' ? 85 : undefined,
            n: 1,
            user: userId,
        }, {
            timeout: Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 180000),
            maxRetries: Number(process.env.OPENAI_IMAGE_MAX_RETRIES || 2),
        });
        const candidate = response.data?.[0]?.b64_json;
        if (!candidate) throw new Error('OpenAI image generation did not return base64 image data.');
        const validation = await callStructuredResponse({
            model: process.env.OPENAI_IMAGE_VALIDATION_MODEL || process.env.OPENAI_QUALITY_MODEL || 'gpt-5.6-sol',
            reasoningEffort: 'low',
            maxOutputTokens: 300,
            maxRetries: 1,
            schemaName: 'content_image_constraint_check',
            schema: {
                type: 'object', additionalProperties: false,
                required: ['hasProhibitedTextOrLogo', 'reason'],
                properties: {
                    hasProhibitedTextOrLogo: { type: 'boolean' },
                    reason: { type: 'string', maxLength: 180 },
                },
            },
            instructions: 'Inspect ministry artwork for any visible or pseudo-visible words, letters, numbers, captions, signs, logos, brand marks, or watermarks. Treat malformed lettering and scripture-like glyphs as prohibited. Do not assess theology or aesthetics.',
            input: [{ role: 'user', content: [{ type: 'input_text', text: 'Does this artwork contain any prohibited lettering or logo? Return the strict JSON decision.' }, { type: 'input_image', image_url: `data:image/${outputFormat};base64,${candidate}`, detail: 'low' }] }],
        });
        if (!validation.data.hasProhibitedTextOrLogo) {
            imageData = candidate;
            break;
        }
        if (visualAttempt === 2) {
            const constraintError = new Error('Generated artwork repeatedly contained prohibited lettering or logos.');
            constraintError.code = 'IMAGE_CONTENT_CONSTRAINT_FAILED';
            throw constraintError;
        }
    }
    if (!imageData) {
        throw new Error('OpenAI image generation did not return acceptable image data.');
    }

    const contentTypeHeader = outputFormat === 'png'
        ? 'image/png'
        : outputFormat === 'webp'
            ? 'image/webp'
            : 'image/jpeg';

    const normalizedBuffer = await normalizeContentImageBuffer({
        buffer: Buffer.from(imageData, 'base64'),
        outputFormat,
    });

    const publicUrl = await uploadImageBuffer({
        buffer: normalizedBuffer,
        bucketName,
        storagePath,
        contentType: contentTypeHeader,
    });

    return {
        imageUrl: publicUrl,
        imagePrompt: prompt,
        storagePath,
    };
}

module.exports = {
    buildContentImagePrompt,
    generateContentImage,
};
