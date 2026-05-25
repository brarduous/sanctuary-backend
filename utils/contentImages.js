const openai = require('../config/openai');
const supabase = require('../config/supabase');

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
        'Composition: landscape hero image with a clear focal point, suitable as a sermon thumbnail and header image, with room for optional title overlay.',
        'Avoid: words, lettering, logos, watermarks, distorted hands, celebrity likenesses, denominational symbols unless directly implied, sensational or kitsch imagery.'
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

    const response = await openai.images.generate({
        model: imageModel,
        prompt,
        size: process.env.OPENAI_IMAGE_SIZE || '1536x1024',
        quality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
        output_format: outputFormat,
        output_compression: outputFormat === 'jpeg' || outputFormat === 'webp' ? 85 : undefined,
        n: 1,
        user: userId,
    });

    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
        throw new Error('OpenAI image generation did not return base64 image data.');
    }

    const contentTypeHeader = outputFormat === 'png'
        ? 'image/png'
        : outputFormat === 'webp'
            ? 'image/webp'
            : 'image/jpeg';

    const publicUrl = await uploadImageBuffer({
        buffer: Buffer.from(imageData, 'base64'),
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
