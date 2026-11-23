# SymphonAI: roadmap to a sellable product

| # | Step | Status | Needs from Brandon |
|---|------|--------|--------------------|
| 1 | Prototype: tracking, conducting, voice guide, procedural band | Done (PR #1) | Try it on a real phone |
| 2 | Real-device hardening: front/back camera, tablet stand, low light, tracking fallbacks (hand landmarks) | In progress | Test videos or feedback from your phone |
| 3 | Share feature: record your performance (camera + trail + music) as a video clip | In progress | Nothing |
| 4 | AI music quality: Lyria RealTime engine through a small backend so the API key stays secret | Next | A Gemini API key (Google AI Studio). Costs money per use |
| 5 | Sampled real instruments as offline fallback | Next | Nothing |
| 6 | Accounts, saved sessions, free tier vs paid | Later | Hosting account (Cloudflare or Vercel), Stripe account |
| 7 | Conducting model trained on opted-in session data | Later | Consent wording; a few testers |
| 8 | Packaging: installable PWA, then App Store / Google Play wrapper | Later | Apple Developer ($99/yr), Google Play ($25 once) |
| 9 | Launch basics: domain, privacy policy and terms (camera + AI music), name/trademark check for "SymphonAI" | Later | Domain, a lawyer or template review |

## Business notes
- Real cost driver is AI music generation per minute of play. Pricing must cover it; keep the offline band as the free tier.
- Camera frames are processed on the device and are never uploaded. Keep that promise in the privacy policy.
- Check the generation provider's terms for commercial use of output before charging.
