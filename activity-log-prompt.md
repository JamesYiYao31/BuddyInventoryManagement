Add an action type filter to the activity log tab in Buddy 
Inventory Management. Reference CLAUDE.md for all conventions.

## Current filters that already exist (do not touch)
- Global search (lot or item name)
- Filter by item (checkbox list)
- Filter by user (dropdown)
- Date range (start date + end date)

## What to add
A new "Filter by Action" multi-select dropdown in the filter 
panel, placed between "Filter by User" and "Date Range".

## Action types to include (match exact strings from the 
audit_log action column)
- Added
- Edited  
- Opened
- Used
- Ordered
- Submitted COA
- Submitted Lot Validation
- Approved Lot
- Rejected Lot
- Archived Lot
- Deleted from Storage
- Deleted from Bench

## UI behavior
- Label: "FILTER BY ACTION" (match existing filter label style)
- Default: all actions shown (no filter applied)
- Multi-select: user can pick one or more action types
- When one or more selected, only show log entries matching 
  those action types
- Selecting all = same as selecting none (show everything)
- Match the existing checkbox style used for "Filter Items"
- Add an "All Actions" checkbox at the top that toggles all 
  on/off, same pattern as if you had "All Items"

## Filter logic
Apply client-side on the already-fetched log entries — 
no new queries needed. Filter should stack with all 
existing filters (search + item + user + date all work 
together with action filter).

## Quick-access action badges (optional enhancement)
Above the filter panel or at the top of the log, add 
horizontal scrollable quick-filter pills:
  [All] [Added] [Opened] [Deleted] [Used]
Tapping a pill sets that single action filter instantly.
These are the most common actions a manager needs to 
isolate quickly.

## Do not change
- The activity log query or data fetching
- The existing filter panel layout and styling
- The audit log row design
- Any other tab or component

Reference CLAUDE.md for all architecture conventions and 
coding standards.