// cv.ts — Hardcoded CV grounding context for the "Ask My Résumé" chatbot.
// This string is injected into the Gemini system prompt at /api/chat.ts.
// Only add real, verifiable information here — the eval suite tests these facts directly.
// Do not invent skills, projects, or credentials that don't exist.

export const cvMarkdown = `# Neeha Koka — Resume Grounding

**Profile:** Student and Entry-Level Professional (Fresher) based in Hyderabad. Technical skills are emerging/fresher level.

## Project 1
**Full-stack Student Records Web Application (Django)**
- Built using Django.
- Features:
  - Django Admin integration
  - Role-based access control
  - Centralized student data management
  - Roll number lookup module

## Project 2
**TCS NQT (National Qualifier Test) Preparation & Strategy**
- Preparation & strategy logic models.

## Interests
- Cybersecurity foundations
- Aviation-related technology systems
- Behavioral/social matching models
`;
