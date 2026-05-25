-- Streamline onboarding improvement areas around the core Christian issues
-- from the 2026-05-25 review. This keeps the existing app_options record and
-- user_preferences.improvementAreas contract intact.

update app_options
set options = '[
  {
    "title": "Spiritual Dryness",
    "description": "When God feels silent, distant, or hard to hear during difficult seasons.",
    "subIssues": [
      "I cannot hear God",
      "Where is God in my pain?",
      "Feeling spiritually numb",
      "Praying but feeling alone"
    ]
  },
  {
    "title": "Habitual Sin & Guilt",
    "description": "Cycles of sin, shame, repentance, and discouragement.",
    "subIssues": [
      "Repeated sin patterns",
      "Porn or sexual temptation",
      "Anger and self-control",
      "Feeling too far gone",
      "Receiving grace after failure"
    ]
  },
  {
    "title": "Evangelism Anxiety",
    "description": "Fear and burden around loved ones, faith conversations, and home tension.",
    "subIssues": [
      "A loved one''s salvation",
      "Sharing faith without pressure",
      "Unequally yoked relationships",
      "Boundaries with family"
    ]
  },
  {
    "title": "Mental Health",
    "description": "Loneliness, anxiety, and the need for Christian community and care.",
    "subIssues": [
      "Loneliness",
      "Anxiety",
      "Finding real community",
      "Emotional exhaustion"
    ]
  },
  {
    "title": "Daily Discipline",
    "description": "Making space for prayer, Scripture, and attention in a busy life.",
    "subIssues": [
      "No time to pray",
      "How to study the Bible",
      "Digital distraction",
      "Building consistent habits"
    ]
  },
  {
    "title": "Apologetics & Doubt",
    "description": "Questions about faith, Scripture, truth, science, and deconstruction.",
    "subIssues": [
      "Is it a sin to doubt?",
      "Deconstruction",
      "Science and faith",
      "Trusting the Bible"
    ]
  },
  {
    "title": "Church & Culture",
    "description": "Church hurt, hypocrisy, politics, and following Jesus in a polarized world.",
    "subIssues": [
      "Church hurt",
      "Hypocrisy in leadership",
      "Faith and politics",
      "Spiritual abuse recovery",
      "Forgiveness and trust"
    ]
  },
  {
    "title": "Other",
    "description": "Something more personal or specific that you want Sanctuary to help you focus on.",
    "subIssues": []
  }
]'::jsonb
where name = 'improvement_areas';
