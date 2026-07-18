const sharp = require('sharp');

const CONTENT_IMAGE_WIDTH = 1536;
const CONTENT_IMAGE_HEIGHT = 864;

const normalizeContentImageBuffer = async ({ buffer, outputFormat }) => {
    const format = outputFormat === 'png' ? 'png' : outputFormat === 'webp' ? 'webp' : 'jpeg';
    return sharp(buffer)
        .resize(CONTENT_IMAGE_WIDTH, CONTENT_IMAGE_HEIGHT, {
            fit: 'contain',
            position: 'centre',
            background: { r: 15, g: 23, b: 42, alpha: 1 },
            withoutEnlargement: false,
        })
        .toFormat(format, format === 'png' ? {} : { quality: 85 })
        .toBuffer();
};

module.exports = { normalizeContentImageBuffer, CONTENT_IMAGE_WIDTH, CONTENT_IMAGE_HEIGHT };
