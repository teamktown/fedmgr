# Minimal, self-contained demo image for the E1 round trip.
# Stands in for "an MCP container" so the sign → SBOM → trustmark → verify loop
# has a real, reproducible artifact to operate on.
FROM alpine:3.20
LABEL org.letsfederate.entity="https://trust.letsfederate.org/mcp/fedmgr-mcp"
LABEL org.letsfederate.role="mcp-server-demo"
CMD ["sh", "-c", "echo 'fedmgr-mcp demo container'; sleep infinity"]
