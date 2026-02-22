# Security Policy

I take security seriously. Yes, I know that sentence usually precedes a data breach announcement, but I actually mean it.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
| < 0.1   | No        |

Only the latest release gets patches. Running something older? Update first. That's literally what this tool does.

## Reporting a Vulnerability

**Do NOT open a public GitHub issue.** I will be very cross.

Email **hello@vcode.sh** with:

- **What** -- describe the vulnerability.
- **How** -- steps to reproduce it.
- **So what** -- what an attacker could actually do with this.
- **Fix** -- if you've got one. Not required, but I'll owe you a coffee.

### Response Times

- **48 hours** -- I'll acknowledge your report.
- **7 days** -- critical vulnerabilities get patched.
- **30 days** -- everything else gets a fix or a documented workaround.

If I go silent, follow up. I'm one person with a keyboard, not a 24/7 SOC team.

## What I've Already Thought About

So you don't have to:

- **SQLite cache with WAL mode** -- no corruption from concurrent access. Your cache is safe even if you run depfresh from 5 terminals simultaneously. Don't ask me how I know.
- **Auth token handling** -- `.npmrc` tokens are used for registry requests but never logged, cached, or written anywhere. Debug mode redacts them. I'm not trying to end up on HackerNews.
- **Exponential backoff** -- prevents request amplification. I won't accidentally DDoS npm. You're welcome, Isaac.
- **AbortController timeouts** -- every request has a timeout. No hanging connections, no resource leaks, no "why is my process still running" at 3am.
- **No arbitrary code execution** -- depfresh reads JSON and fetches metadata. That's it. No install scripts, no postinstall hooks, no eval(). Boring by design.

## Disclosure

Once a fix ships, I publish a security advisory on GitHub with full details. Credit goes to the reporter unless they prefer to remain anonymous. Fame is optional, good security isn't.
