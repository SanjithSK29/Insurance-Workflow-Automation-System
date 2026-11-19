# Sprint outcome videos

Course deliverables Part-2, items 2.g–h (Sprint 1, one minute) and 3.b (Sprint 2, two minutes): a video of the working product after each sprint, uploaded to the repository.

| Video | Length | Shows |
| --- | --- | --- |
| [sprint-1-outcome.mp4](sprint-1-outcome.mp4) | 1:03 | A customer signs in, gets a personalised quote (F-001), applies with KYC and automated risk scoring (F-002, F-003), pays with a sandbox card token and receives the signed policy and GST invoice, with the signature verified (F-010, F-013, SR-005), then files a claim with a document (F-020) and sees it routed for review |
| [sprint-2-outcome.mp4](sprint-2-outcome.mp4) | 2:01 | A ₹1,50,000 claim goes through the BPMN workflow: adjuster review with fraud indicators, then senior approval by an admin who signs in with MFA (F-021, F-022, SR-002); settlement and payout with a signed letter (F-023); the claimant's notifications and tracker (F-024); an underwriter approves a high-risk application (F-002); the admin dashboard, BPMN designer, audit-chain verification and reports (F-030, F-032, F-033, F-034) |

**How they were made.** Both videos were recorded on 19-11-2026 from the real application (`npm start` with the demo data) by `scripts/record-demo-videos.js`, which drives Microsoft Edge through each flow and adds a caption naming the requirement shown. Nothing is mocked: every click goes through the same API and code that the 170 automated tests cover.

**Honest note.** The course asked for these videos at the end of each sprint (23 Oct and 30 Oct 2026). They were not recorded then (see `docs/SPRINTS.md`, "What went wrong"). They show the Sprint 1 and Sprint 2 scope as it works in the final product, and each video's title card states the recording date.

Recording the Sprint 2 video exposed a display defect, DEF-17 (fraud indicators shown as "[object HTMLDivElement]" on the adjuster's screen), which was fixed before the final recording; see `docs/reports/DEFECT_LOG.md`.
