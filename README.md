# Health Agent

AI-powered healthcare navigation and caregiver command center.

**USPTO Provisional Patent Filed** — Application #64/002,221 (March 2026)

## Features

- AI Chat (Claude Sonnet 4) with medical context awareness
- Document Scanning — insurance cards, prescriptions, lab results, bills via Claude Vision
- Provider Finder — clickable Zocdoc/Healthgrades/Google search links
- Doctor Switching — guided workflow for changing providers
- Email Drafting & Sending (Resend)
- AI Phone Calls (Vapi)
- Google Calendar OAuth integration
- Medication Tracking with refill dates, pharmacy, prescriber, Rx numbers
- Insurance Claims & Appeals tracking
- Task Manager with priorities and due dates
- Medical Timeline, Emergency Playbooks, Doctor Brief PDF
- Multi-Patient support for families
- Notifications system
- iMessage-style UI with light/dark mode

## Stack

Node.js + Express | Claude API | Vapi | Resend | Google Calendar OAuth | Railway

## Setup

```bash
npm install
# Create .env with: ANTHROPIC_API_KEY, RESEND_API_KEY, VAPI_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
npm start
```

## Ports

Health Agent: 3000 | DealMatcher: 3001 | TerraVault: 3002

## Deploy

```bash
GIT_ASKPASS="" git push origin main
```
