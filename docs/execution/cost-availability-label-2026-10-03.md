# Cost availability chart meaning

The GCP dashboard plots each vendor's binary cost-availability observations with
`ALIGN_MEAN` over `86400s`. A day containing available and unavailable snapshots
can therefore display a fraction. The old binary chart title hid that distinction.

The title now names the daily average and per-vendor scope. The guide explains
mixed availability and that a blank reading is unknown. Aggregation, collection,
metric labels, finance values, private invoice history and alerts are unchanged.
This is a label repair, not broader cost coverage or a claim of a complete invoice.

This session owns the dashboard definition and this record. There is no unmerged
dependency. Existing observability tests and independent review verify the source;
live usability requires the exact shared dashboard to render in the authorized
browser after the reviewed definition is applied. API readback alone is insufficient.
