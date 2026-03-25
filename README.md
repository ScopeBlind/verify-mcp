# @scopeblind/verify-mcp

MCP server for offline verification of ScopeBlind and Veritas Acta artifacts.

It is deliberately narrow:
- verify a single signed receipt or artifact
- verify an audit bundle offline
- explain a signed artifact in normalized form
- run a packaged self-test so clients can prove the verifier works

This is the registry-worthy MCP surface for the verification lane. It is not a gateway, not a builder, and not a hosted verification service.

[![verify-mcp MCP server](https://glama.ai/mcp/servers/tomjwxf/verify-mcp/badges/card.svg)](https://glama.ai/mcp/servers/tomjwxf/verify-mcp)

## Install

```bash
npm install -g @scopeblind/verify-mcp
```

## Claude Desktop / MCP config

```json
{
  "mcpServers": {
    "scopeblind-verify": {
      "command": "npx",
      "args": ["-y", "@scopeblind/verify-mcp"]
    }
  }
}
```

## Tools

### `self_test`
Runs packaged sample verification.

Returns:
- sample receipt valid / invalid
- sample bundle valid / invalid
- total receipts in the sample bundle

### `verify_receipt`
Inputs:
- `artifact_json` or `path`
- optional `public_key_hex`

Returns:
- valid / invalid
- type
- format
- issuer
- kid
- canonical hash

### `verify_bundle`
Inputs:
- `bundle_json` or `path`

Returns:
- valid / invalid
- total receipts
- passed
- failed

### `explain_artifact`
Inputs:
- `artifact_json` or `path`

Returns a normalized summary of:
- type
- format
- issuer
- kid
- issued_at / timestamp
- payload keys

## Notes

- No ScopeBlind servers are contacted.
- This server verifies local JSON artifacts only.
- `protect-mcp` remains the local policy gateway.
- `@scopeblind/passport` remains the local pack builder.
- `@scopeblind/red-team` remains the local benchmark runner.

## License

MIT