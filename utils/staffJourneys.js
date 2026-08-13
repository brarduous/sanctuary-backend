function isStaffJourneyVisible({ capabilities, isOwner, status }) {
  if (capabilities.has('content.write') && isOwner) return true;
  if (capabilities.has('communications.write') && ['ready', 'scheduled', 'published'].includes(status)) return true;
  return capabilities.has('content.read') && status === 'published';
}

module.exports = { isStaffJourneyVisible };
