#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  verifyArtifact,
  canonicalHash,
  bytesToHex,
  base64urlToBytes,
} from '@veritasacta/artifacts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readJsonInput(path, raw) {
  if (raw && raw.trim()) return JSON.parse(raw);
  if (path && path.trim()) return JSON.parse(readFileSync(path, 'utf-8'));
  throw new Error('Provide either raw JSON input or a file path.');
}

function isPassportEnvelope(obj) {
  return obj && typeof obj === 'object'
    && obj.payload && typeof obj.payload === 'object'
    && obj.signature && typeof obj.signature === 'object'
    && typeof obj.signature.sig === 'string';
}

function convertPassportToV1(envelope) {
  return {
    artifact: { ...envelope.payload, signature: envelope.signature.sig },
    kid: envelope.signature.kid || null,
    format: 'passport',
  };
}

function deriveEmbeddedKey(artifact) {
  const payload = artifact?.payload || artifact;
  if (payload?.public_key && typeof payload.public_key === 'string' && payload.public_key.length === 64) {
    return payload.public_key;
  }
  return null;
}

function formatArtifact(artifact) {
  if (isPassportEnvelope(artifact)) return 'passport';
  if (artifact?.v === 2) return 'v2';
  return 'v1';
}

function getArtifactCore(artifact) {
  if (isPassportEnvelope(artifact)) {
    return convertPassportToV1(artifact);
  }
  return {
    artifact,
    kid: artifact?.kid || null,
    format: formatArtifact(artifact),
  };
}

function resolveBundleKeyMap(bundle) {
  const keys = bundle?.verification?.signing_keys || [];
  const map = new Map();
  for (const jwk of keys) {
    if (jwk?.kid && jwk?.x) {
      map.set(jwk.kid, bytesToHex(base64urlToBytes(jwk.x)));
    }
  }
  return map;
}

function verifySingle(artifact, publicKeyHex) {
  const core = getArtifactCore(artifact);
  const key = publicKeyHex || deriveEmbeddedKey(artifact);
  if (!key) {
    return {
      valid: false,
      error: 'no_public_key',
      type: artifact?.type || core.artifact?.type || 'unknown',
      format: core.format,
      kid: core.kid,
      issuer: artifact?.issuer || null,
      hash: null,
    };
  }

  const result = verifyArtifact(core.artifact, key);
  const unsigned = { ...core.artifact };
  delete unsigned.signature;

  return {
    valid: !!result.valid,
    error: result.valid ? null : (result.error || 'invalid_signature'),
    type: artifact?.type || core.artifact?.type || 'unknown',
    format: core.format,
    kid: core.kid,
    issuer: artifact?.issuer || null,
    hash: canonicalHash(unsigned),
  };
}

function verifyBundle(bundle) {
  if (!bundle?.receipts || !Array.isArray(bundle.receipts)) {
    throw new Error('Invalid bundle: missing receipts array');
  }
  const keyMap = resolveBundleKeyMap(bundle);
  let passed = 0;
  const receipts = bundle.receipts.map((receipt, index) => {
    const key = receipt?.kid ? keyMap.get(receipt.kid) : deriveEmbeddedKey(receipt);
    const result = verifySingle(receipt, key || null);
    if (result.valid) passed += 1;
    return {
      index,
      type: result.type,
      kid: result.kid,
      valid: result.valid,
      error: result.error,
    };
  });
  return {
    valid: passed === bundle.receipts.length,
    total: bundle.receipts.length,
    passed,
    failed: bundle.receipts.length - passed,
    receipts,
  };
}

function explainArtifact(artifact) {
  const core = getArtifactCore(artifact);
  const payload = artifact?.payload || core.artifact?.payload || core.artifact;
  const payloadKeys = payload && typeof payload === 'object'
    ? Object.keys(payload).filter((k) => k !== 'signature').sort()
    : [];

  return {
    type: artifact?.type || core.artifact?.type || 'unknown',
    format: core.format,
    issuer: artifact?.issuer || null,
    kid: core.kid,
    issued_at: artifact?.issued_at || artifact?.timestamp || payload?.issued_at || null,
    payload_keys: payloadKeys,
  };
}

function loadSelfTestArtifacts() {
  return {
    receipt: JSON.parse(readFileSync(join(__dirname, 'samples', 'sample-receipt.json'), 'utf-8')),
    bundle: JSON.parse(readFileSync(join(__dirname, 'samples', 'sample-bundle.json'), 'utf-8')),
    publicKeyHex: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  };
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({
  name: 'scopeblind-verify',
  version: '0.1.0',
  description: 'Offline verification MCP server for ScopeBlind and Veritas Acta artifacts.',
});

server.tool(
  'self_test',
  'Verify the packaged sample receipt and sample bundle to prove the verifier works offline.',
  {},
  async () => {
    try {
      const { receipt, bundle, publicKeyHex } = loadSelfTestArtifacts();
      const receiptResult = verifySingle(receipt, publicKeyHex);
      const bundleResult = verifyBundle(bundle);
      return textResult({
        ok: receiptResult.valid && bundleResult.valid,
        receipt: receiptResult,
        bundle: {
          valid: bundleResult.valid,
          total: bundleResult.total,
          passed: bundleResult.passed,
          failed: bundleResult.failed,
        },
        note: 'No ScopeBlind servers were contacted.',
      });
    } catch (error) {
      return textResult({ ok: false, error: error.message });
    }
  }
);

server.tool(
  'verify_receipt',
  'Verify a single signed artifact or receipt using an explicit public key or any embedded public key.',
  {
    artifact_json: z.string().optional().describe('Raw JSON artifact string.'),
    path: z.string().optional().describe('Path to a local JSON artifact file.'),
    public_key_hex: z.string().optional().describe('Optional Ed25519 public key hex (64 bytes as hex).'),
  },
  async (args) => {
    try {
      const artifact = readJsonInput(args.path, args.artifact_json);
      return textResult(verifySingle(artifact, args.public_key_hex || null));
    } catch (error) {
      return textResult({ ok: false, error: error.message });
    }
  }
);

server.tool(
  'verify_bundle',
  'Verify a ScopeBlind audit bundle offline using the embedded verification keys.',
  {
    bundle_json: z.string().optional().describe('Raw JSON bundle string.'),
    path: z.string().optional().describe('Path to a local JSON bundle file.'),
  },
  async (args) => {
    try {
      const bundle = readJsonInput(args.path, args.bundle_json);
      return textResult(verifyBundle(bundle));
    } catch (error) {
      return textResult({ ok: false, error: error.message });
    }
  }
);

server.tool(
  'explain_artifact',
  'Explain the format and top-level contents of a signed artifact without requiring a verification key.',
  {
    artifact_json: z.string().optional().describe('Raw JSON artifact string.'),
    path: z.string().optional().describe('Path to a local JSON artifact file.'),
  },
  async (args) => {
    try {
      const artifact = readJsonInput(args.path, args.artifact_json);
      return textResult(explainArtifact(artifact));
    } catch (error) {
      return textResult({ ok: false, error: error.message });
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
