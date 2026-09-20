-- Preserve user preferences in the devotional playbook while making the
-- application responsible for enforcing Spotify suitability.

update public.system_prompts
set content = replace(
  replace(
    content,
    '- Pastoral/background notes: {{user_pastoral_notes}}',
    '- Pastoral/background notes: {{user_pastoral_notes}}' || E'\n' ||
    '- Recent devotional titles and passages: {{user_recent_devotionals}}' || E'\n' ||
    '- Preferred gospel artists: {{user_music_preferences}}'
  ),
  '6. Apply the base playbook''s three-slide Notice → Ground → Practice structure to the same curriculum and application.',
  '6. Apply the base playbook''s three-slide Notice → Ground → Practice structure to the same curriculum and application.' || E'\n' ||
  '7. Honor the user''s style feedback, focus areas, improvement areas, and recent devotional history without overriding today''s curriculum or repeating private profile language.' || E'\n' ||
  '8. Use preferred gospel artists only to guide the music recommendation. Do not force an artist whose music does not fit today''s message. The application will independently reject explicit or non-ministry tracks.'
)
where key = 'daily_devotional_personalization_wrapper';
