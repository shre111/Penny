// Escape a string so it can be used as a literal inside a RegExp / Mongo
// $regex. Without this, user/agent input containing regex metacharacters
// (e.g. an unbalanced "(" in a client name) produces an invalid regex and
// crashes the query, or silently changes its meaning.
export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
