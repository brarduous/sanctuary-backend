require('dotenv').config();
const { dispatchDuePublicationNotifications } = require('../routes/contentPacks');

dispatchDuePublicationNotifications(new Date())
  .then((summary) => { console.log('[Church Content] Dispatch complete', summary); process.exit(0); })
  .catch((error) => { console.error('[Church Content] Dispatch failed', error); process.exit(1); });
