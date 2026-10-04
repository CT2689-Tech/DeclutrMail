# Supabase database root certificate

`supabase-root-2021.crt` is the public Supabase CA downloaded on 2026-10-03 from
[the vendor download](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).
It expires on 2031-04-26. DER SHA-256:
`807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`.
PEM file SHA-256:
`700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.

The API uses this CA only when production explicitly selects node-postgres,
the connection host is a Supabase database or pooler, and the DSN does not
already provide `sslrootcert`. It keeps `sslmode=verify-full`, including
hostname verification. It does not expand global Node TLS trust or change
the worker's driver. See [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
and [node-postgres SSL configuration](https://node-postgres.com/features/ssl).

To rotate, download the vendor certificate, verify its fingerprint and validity
against Supabase project settings, update the pin test and this file, and run
the bounded database probe in the built image before release.
