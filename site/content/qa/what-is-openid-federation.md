---
question: What is OpenID Federation and why does MCP need it?
arc: deploy-oidf-with-ai
audience: [local-dev, enterprise, operator]
tags: [oidf, basics, mcp, trust]
---
OpenID Federation (OIDF) is a standard for **establishing trust between many parties without a
central account at each one**. Every participant — a trust anchor at the root, intermediates, and
leaf entities — publishes a signed statement about itself at a well-known URL. A verifier starts
from a leaf, follows its `authority_hints` up to a trust anchor it already trusts, and checks the
signature at every hop. If the chain is intact and terminates at your anchor, the leaf is trusted;
if any signature or binding fails, it is not.

MCP (the Model Context Protocol) lets an AI assistant call external tool servers. Today an assistant
mostly **assumes** a tool server is legitimate because someone pasted its URL. OpenID Federation
replaces that assumption with **verification**: the assistant can resolve a trust chain from the tool
server up to an anchor you chose, and refuse to connect if the chain is broken. That is the whole
premise of fedmgr — verify which MCP servers to trust, don't assume them.
