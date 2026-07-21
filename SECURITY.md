# Security Policy ## Supported Versions We release patches for security vulnerabilities. This table shows which versions are currently supported: | Version | Supported |
|---------|--------------------|
| 0.4.x | :white_check_mark: |
| < 0.4 | :x: | ## Reporting a Vulnerability We take security seriously. If you discover a security vulnerability in Daedalus, please **do not** open a public issue. Instead, send a private report to **bgill55_dev@voxvivid.com** with: - A description of the vulnerability
- Steps to reproduce it
- Affected versions
- Any potential mitigations you've identified You should receive a response within 48 hours. If you don't, please follow up to ensure we received your message. ### What to expect 1. **Acknowledgment** — we'll confirm receipt within 48 hours
2. **Assessment** — we'll investigate and determine impact and severity
3. **Fix** — we'll develop and test a patch
4. **Release** — we'll publish a security advisory and a patched release ### Disclosure We ask that you allow us reasonable time to fix and release a patch before publicly disclosing the vulnerability. ## Security Best Practices When using Daedalus: - **API keys** are stored in `~/.daedalus/config.json` — keep this file secure
- **Local LLM servers** should be bound to localhost (127.0.0.1) to avoid network exposure
- **Review tool execution** — Daedalus runs terminal commands you approve; review them before confirming
- Keep Daedalus updated to the latest version to receive security patches ## Scope The following are **out of scope**: - Social engineering attacks against Daedalus maintainers
- Attacks requiring physical access to the victim's machine
- Vulnerabilities in third-party LLM servers or providers
- Denial of service against local services
