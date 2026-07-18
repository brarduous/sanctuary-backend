const OpenAI = require('openai');
require('dotenv').config();

let client;

function getOpenAIClient() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is required when an OpenAI operation is invoked.');
    }
    if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return client;
}

module.exports = new Proxy({}, {
    get(_target, property) {
        if (property === 'getClient') return getOpenAIClient;
        const value = getOpenAIClient()[property];
        return typeof value === 'function' ? value.bind(getOpenAIClient()) : value;
    },
});
