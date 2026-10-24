# Preserve Cloud Monitoring metric resource paths

The first read-only production verification of the overdue-action alert failed
with HTTP400: Google treated encoded slashes as part of the metric name. The
loose descriptor fixture had accepted either form. No policy was created.

Use the literal slash-separated metric resource name documented by
[Google's descriptor API](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.metricDescriptors/get).
The fixture now asserts the exact native URL; it fails against the encoded path.
Future provider fixtures must validate resource identity rather than only a
shared path prefix. Native verification remains necessary after merge.
