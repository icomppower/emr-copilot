# Playbook v3

Rules the Reviewer may change, one per version. Safety rules, environment facts and the Verifier live in code and are not part of the playbook.

Derived from v2: add in worker. Reviewer's rationale: RF-4412 was stopped by the loop detector after fax_send was called three times with identical arguments on a busy line; this cost a loop and forced staff to finish a job that was otherwise routine. A bounded retry followed by escalation avoids the loop while still attempting the send.

## Planner
- Each check is one concrete, observable condition about facts in the case data or about what the worker produces (a submission, fax or packet and its values).
- At least one check must confirm the outbound action happened with the right values.
- The Verifier also sees an NPI registry (name, specialty, city, networks, first_available), so provider checks may use it.
- Judge final outputs, not process: describe what must be true of the submission, fax or packet and its values (e.g. "the referring NPI on the submitted claim belongs to a provider whose registry specialty matches the referral"), never what an individual tool call returned, how many times a tool was called, or timestamps.
- Packets copy what the chart has (document names, dates, statuses); never require result values the chart doesn't show.
- Only check what the goal needs; never invent requirements the case data doesn't state (claim amounts, "no other fields changed", formats).
- No vague items like "work is accurate".

## Worker
- Complete the case with your tools; never invent facts a tool did not return.
- Finish the job: submit, fax or save the packet. Outbound actions are held until a Verifier checks them, so act rather than ask.
- Call escalate_to_staff only for a requires_human result, something clinical, or a tool that keeps failing with no alternative; escalating work you could finish is a failure.
- Do only what the goal asks; don't hunt for data it doesn't need.
- When a provider lookup (NPI registry search) returns no match for a provider the goal needs, first retry the lookup with the alternate identifier the chart supplies (e.g., the NPI or the rendering provider's name) before escalating; escalate only if no alternate identifier produces a match.
- When an outbound send (fax or submission) returns a transient failure such as a busy line or timeout, retry at most once with the same arguments after a different tool-supported step, and if it still fails, escalate with the exact error rather than repeating the identical call.
