# LeadHunter paced launch

Goal: activate the approved Argentina web campaign with up to 200 total outbound messages daily, all days and hours.

Design: retain the existing database daily cap and add a persistent 432-second mailbox dispatch slot in the worker's SQLite state. Claim one message per slot, including follow-ups. Reserve before claim so crashes cannot cause a burst; idle or failed slots are not accumulated. Poll responses before sending. Other campaigns remain paused.

Implementation:
1. Test pacing across worker instances/restarts and that a blocked slot never claims mail.
2. Add atomic slot reservation to `mail_transport.py`; configure single-message dispatch in `runner.py`.
3. Run the transport tests locally, deploy the worker on Oracle, and verify its settings without exposing credentials.
4. Create a production campaign from the vetted website/scale qualification configuration and approved writing policy. Remove test seed URLs, broaden Argentina discovery, keep 200/day email cap and daily recurrence.
5. Link the existing mailbox, activate the campaign and verify that its first discovery job starts. Do not reactivate old campaigns or cancelled messages.
