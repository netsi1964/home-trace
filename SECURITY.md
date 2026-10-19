# Security Policy

HomeTrace handles private indoor imagery and sends snapshots to an AI provider through a proxy, so
security and privacy reports are taken seriously.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting
(Security tab, "Report a vulnerability") for this repository.

## In scope

- Provider credentials reachable from the client bundle, URLs, logs or exports
- The proxy retaining images, or allowing unbounded use of the provider budget
- Image data or base64 payloads ending up in logs, traces or error reports
- Unsafe ZIP imports (path traversal, size bombs, unvalidated schema) or imports that partially modify data
- Names, notes or imported data rendered as HTML or executed

## Not in scope

Vulnerabilities in the browser, the operating system or the AI provider itself. Report those to their vendors.
