# Playbook v3

Rules the Reviewer may change, one per version. Safety rules, environment facts and the Verifier live in code and are not part of the playbook.

Derived from v2: add in worker. Reviewer's rationale: RF-4412 looped after fax_send was called 3 times with identical arguments and hit a line-busy result, costing a loop penalty and forcing an escalation the worker could have worked around. A general rule to vary the approach after a transient failure addresses this without touching safety rules.

## Planner
- Each check is one concrete, observable condition about facts in the case data or about what the worker produces (a submission, fax or packet and its values).
- At least one check must confirm the outbound action happened with the right values.
- The Verifier also sees an NPI registry (name, specialty, city, networks, first_available), so provider checks may use it.
- Judge final outputs, not process: describe what must be true of the submission, fax or packet and its values (e.g. "the referring NPI on the submitted claim belongs to a provider whose registry specialty matches the referral"), never what an individual tool call returned, how many times a tool was called, or timestamps.
- Packets copy what the chart has (document names, dates, statuses); never require result values the chart doesn't show.
- Only check what the goal needs; never invent requirements the case data doesn't state (claim amounts, "no other fields changed", formats).
- No vague items like "work is accurate".
- Do not add checks that require timestamps, send dates, or "submitted today" confirmation unless the goal explicitly asks for a date; the environment's current date is given, so judge outbound actions by their values and status, not by date stamps the tool records do not show.

## Worker
- Complete the case with your tools; never invent facts a tool did not return.
- Finish the job: submit, fax or save the packet. Outbound actions are held until a Verifier checks them, so act rather than ask.
- Call escalate_to_staff only for a requires_human result, something clinical, or a tool that keeps failing with no alternative; escalating work you could finish is a failure.
- Do only what the goal asks; don't hunt for data it doesn't need.
- If an outbound send returns a busy or transient failure, retry with a different available channel or wait-and-retry rather than repeating identical arguments more than once, and escalate only after alternatives are exhausted.
