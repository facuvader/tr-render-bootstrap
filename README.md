# Private Node deployment bootstrap

This generic launcher contains no business application, Firebase configuration,
customer data or credentials. It obtains one pinned commit from a private
GitHub repository using a repository-scoped **read-only** deploy key.

The application source remains private. Configure the repository, exact commit,
source file count and base64-encoded OpenSSH deploy key as private build settings.
Use `npm run build` and `npm start`. Supply the application's independent runtime
settings separately. Never supply a GitHub personal access token.

GitHub's Ed25519 host key is pinned to its officially published fingerprint.
SSH keys exist only in a managed temporary build directory, are removed after
the source checkout and are not passed to the application process. Source hashes
are rechecked at startup. Dependency lifecycle scripts are disabled.
An identical-revision build cache is replaced only after its source hashes and
ownership marker are verified and the next private source fetch succeeds.
Unknown, tampered, or different-revision caches are never deleted; choose the
hosting provider's clean-cache build when intentionally changing revisions.

This is a test deployment launcher, not a promise of production availability.
Do not use pings or other traffic to evade a hosting provider's free-tier limits.
